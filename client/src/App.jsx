// client/src/App.jsx
import { useState, useEffect, useCallback } from 'react';
import { 
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  RefreshCw, TrendingUp, TrendingDown, Plus, Trash2, 
  Store, ChevronDown, ChevronUp, ArrowUpDown, Calendar 
} from 'lucide-react';

const API_BASE = '/api';

const STORES = {
  vironax: {
    id: 'vironax',
    name: 'VironaX',
    tagline: "Men's Jewelry",
    currency: 'SAR',
    currencySymbol: 'SAR',
    ecommerce: 'Salla',
    defaultAOV: 280
  },
  shawq: {
    id: 'shawq',
    name: 'Shawq',
    tagline: 'Palestinian & Syrian Apparel',
    currency: 'USD',
    currencySymbol: '$',
    ecommerce: 'Shopify',
    defaultAOV: 75
  }
};

const TABS = ['Dashboard', 'Budget Efficiency', 'Manual Data'];

export default function App() {
  const [currentStore, setCurrentStore] = useState('vironax');
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  
  const [dateRange, setDateRange] = useState({ type: 'days', value: 7 });
  const [customRange, setCustomRange] = useState({ 
    start: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  
  const [dashboard, setDashboard] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [efficiencyTrends, setEfficiencyTrends] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [manualOrders, setManualOrders] = useState([]);
  const [availableCountries, setAvailableCountries] = useState([]);
  const [breakdownData, setBreakdownData] = useState([]);
  
  // KPI charts
  const [expandedKpis, setExpandedKpis] = useState([]);
  // Section 2 breakdown (pure meta)
  const [breakdown, setBreakdown] = useState('none');
  // Country trends
  const [countryTrends, setCountryTrends] = useState([]);
  
  const store = STORES[currentStore];
  const [orderForm, setOrderForm] = useState({
    date: new Date().toISOString().split('T')[0],
    country: 'SA',
    campaign: '',
    orders_count: 1,
    revenue: 280,
    source: 'whatsapp',
    notes: ''
  });

  // Load store from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('selectedStore');
      if (saved && STORES[saved]) {
        setCurrentStore(saved);
      }
    } catch (e) {
      console.error('Error reading localStorage:', e);
    }
    setStoreLoaded(true);
  }, []);

  // Save store selection to localStorage whenever it changes
  useEffect(() => {
    if (!storeLoaded) return;
    try {
      localStorage.setItem('selectedStore', currentStore);
    } catch (e) {
      console.error('Error writing localStorage:', e);
    }
  }, [currentStore, storeLoaded]);

  useEffect(() => {
    const newStore = STORES[currentStore];
    setOrderForm(prev => ({
      ...prev,
      country: currentStore === 'vironax' ? 'SA' : 'US',
      revenue: newStore.defaultAOV
    }));
  }, [currentStore]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ store: currentStore });
      
      if (dateRange.type === 'custom') {
        params.set('startDate', dateRange.start);
        params.set('endDate', dateRange.end);
      } else if (dateRange.type === 'yesterday') {
        params.set('yesterday', '1');
      } else {
        params.set(dateRange.type, dateRange.value);
      }
      
      const [
        dashData,
        effData,
        effTrends,
        recs,
        orders,
        countries,
        cTrends
      ] = await Promise.all([
        fetch(`${API_BASE}/analytics/dashboard?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/efficiency?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/efficiency/trends?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/recommendations?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/manual?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/countries?store=${currentStore}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/countries/trends?${params}`).then(r => r.json())
      ]);
      
      setDashboard(dashData);
      setEfficiency(effData);
      setEfficiencyTrends(effTrends);
      setRecommendations(recs);
      setManualOrders(orders);
      setAvailableCountries(countries);
      setCountryTrends(cTrends);
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  }, [currentStore, dateRange]);

  useEffect(() => {
    if (storeLoaded) {
      loadData();
    }
  }, [loadData, storeLoaded]);

  // Load breakdown data for Section 2 (pure meta)
  useEffect(() => {
    if (!storeLoaded) return;
    
    async function loadBreakdown() {
      if (breakdown === 'none') {
        setBreakdownData([]);
        return;
      }
      
      try {
        const params = new URLSearchParams({ store: currentStore });

        if (dateRange.type === 'custom') {
          params.set('startDate', dateRange.start);
          params.set('endDate', dateRange.end);
        } else if (dateRange.type === 'yesterday') {
          params.set('yesterday', '1');
        } else {
          params.set(dateRange.type, dateRange.value);
        }
        
        const endpoint = `${API_BASE}/analytics/campaigns/by-${breakdown}?${params}`;
        const data = await fetch(endpoint).then(r => r.json());
        setBreakdownData(data);
      } catch (error) {
        console.error('Error loading breakdown:', error);
        setBreakdownData([]);
      }
    }
    
    loadBreakdown();
  }, [breakdown, currentStore, dateRange, storeLoaded]);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/sync?store=${currentStore}`, { method: 'POST' });
      await loadData();
    } catch (error) {
      console.error('Sync error:', error);
    }
    setSyncing(false);
  }

  async function handleAddOrder(e) {
    e.preventDefault();
    try {
      await fetch(`${API_BASE}/manual?store=${currentStore}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderForm)
      });
      setOrderForm(prev => ({
        ...prev,
        orders_count: 1,
        revenue: STORES[currentStore].defaultAOV,
        notes: ''
      }));
      loadData();
    } catch (error) {
      console.error('Error adding order:', error);
    }
  }

  async function handleDeleteOrder(id) {
    if (!confirm('Delete this order?')) return;
    try {
      await fetch(`${API_BASE}/manual/${id}`, { method: 'DELETE' });
      loadData();
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  }

  async function handleBulkDelete(scope, date) {
    if (!confirm(`Delete all manual data for ${scope}?`)) return;
    try {
      await fetch(`${API_BASE}/manual/delete-bulk?store=${currentStore}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, date })
      });
      loadData();
    } catch (error) {
      console.error('Bulk delete error:', error);
    }
  }

  const formatCurrency = (value, decimals = 0) => {
    const symbol = store.currencySymbol;
    if (symbol === '$') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value || 0);
    }
    return `${Math.round(value || 0).toLocaleString()} ${symbol}`;
  };

  const formatNumber = (value) => {
    const v = value || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return Math.round(v).toString();
  };

  const getDateRangeLabel = () => {
    if (dateRange.type === 'custom') {
      const formatDate = (d) => {
        const date = new Date(d);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      };
      return `${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}`;
    }
    if (dateRange.type === 'yesterday') return 'Yesterday';
    if (dateRange.type === 'days' && dateRange.value === 1) return 'Today';
    if (dateRange.type === 'days') return `Last ${dateRange.value} days`;
    if (dateRange.type === 'weeks') return `Last ${dateRange.value} weeks`;
    if (dateRange.type === 'months') return `Last ${dateRange.value} months`;
    return 'Custom';
  };

  if (!storeLoaded || (loading && !dashboard)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-500" />
          <p className="text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  onClick={() => setStoreDropdownOpen(!storeDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <Store className="w-4 h-4 text-gray-600" />
                  <span className="font-bold text-gray-900">{store.name}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-500 transition-transform ${
                      storeDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                
                {storeDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    {Object.values(STORES).map(s => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setCurrentStore(s.id);
                          setStoreDropdownOpen(false);
                          setExpandedKpis([]);
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 ${
                          currentStore === s.id ? 'bg-indigo-50' : ''
                        }`}
                      >
                        <div className="font-semibold text-gray-900">{s.name}</div>
                        <div className="text-sm text-gray-500">
                          {s.tagline} • {s.ecommerce}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded">
                Dashboard
              </span>
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                {dashboard?.dateRange &&
                  `${dashboard.dateRange.startDate} to ${dashboard.dateRange.endDate}`}
              </span>
              <button 
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-1 bg-white p-1.5 rounded-xl shadow-sm mb-6 w-fit">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === i 
                  ? 'bg-gray-900 text-white' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Date Range Picker */}
        <div className="flex items-center gap-3 bg-white p-4 rounded-xl shadow-sm mb-6 flex-wrap">
          <span className="text-sm font-medium text-gray-700">Period:</span>
          
          {/* Today */}
          <button
            onClick={() => { setDateRange({ type: 'days', value: 1 }); setShowCustomPicker(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange.type === 'days' && dateRange.value === 1
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            Today
          </button>
          
          {/* Yesterday */}
          <button
            onClick={() => { setDateRange({ type: 'yesterday', value: 1 }); setShowCustomPicker(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange.type === 'yesterday'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            Yesterday
          </button>
          
          {[3, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => { setDateRange({ type: 'days', value: d }); setShowCustomPicker(false); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dateRange.type === 'days' && dateRange.value === d
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              {d}D
            </button>
          ))}

          {/* Custom Range */}
          <div className="relative">
            <button
              onClick={() => setShowCustomPicker(!showCustomPicker)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                dateRange.type === 'custom'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Custom
            </button>
            
            {showCustomPicker && (
              <div className="absolute top-full mt-2 left-0 bg-white rounded-xl shadow-lg border border-gray-200 p-4 z-50 min-w-[280px]">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={customRange.start}
                      onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
                      max={customRange.end || new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={customRange.end}
                      onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
                      min={customRange.start}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        if (customRange.start && customRange.end) {
                          setDateRange({ type: 'custom', start: customRange.start, end: customRange.end });
                          setShowCustomPicker(false);
                        }
                      }}
                      disabled={!customRange.start || !customRange.end}
                      className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => setShowCustomPicker(false)}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="ml-auto text-sm text-gray-500">
            Showing: <strong>{getDateRangeLabel()}</strong>
          </div>
        </div>

        {activeTab === 0 && dashboard && (
          <DashboardTab 
            dashboard={dashboard} 
            expandedKpis={expandedKpis}
            setExpandedKpis={setExpandedKpis}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
            breakdown={breakdown}
            setBreakdown={setBreakdown}
            breakdownData={breakdownData}
            store={store}
            countryTrends={countryTrends}
          />
        )}
        
        {activeTab === 1 && efficiency && (
          <EfficiencyTab 
            efficiency={efficiency}
            trends={efficiencyTrends}
            recommendations={recommendations}
            formatCurrency={formatCurrency}
          />
        )}
        
        {activeTab === 2 && (
          <ManualDataTab
            orders={manualOrders}
            form={orderForm}
            setForm={setOrderForm}
            onSubmit={handleAddOrder}
            onDelete={handleDeleteOrder}
            onBulkDelete={handleBulkDelete}
            formatCurrency={formatCurrency}
            store={store}
            availableCountries={availableCountries}
          />
        )}
      </div>
      
      {storeDropdownOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setStoreDropdownOpen(false)} />
      )}
    </div>
  );
}

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

function DashboardTab({
  dashboard,
  expandedKpis,
  setExpandedKpis,
  formatCurrency,
  formatNumber,
  breakdown,
  setBreakdown,
  breakdownData,
  store,
  countryTrends
}) {
  const { overview, trends, campaigns, countries, diagnostics } = dashboard;
  
  const [countrySortConfig, setCountrySortConfig] = useState({ field: 'totalOrders', direction: 'desc' });
  const [campaignSortConfig, setCampaignSortConfig] = useState({ field: 'spend', direction: 'desc' });
  const [showCountryTrends, setShowCountryTrends] = useState(false);
  const [metaView, setMetaView] = useState('campaign'); // 'campaign' | 'country'
  const [showMetaBreakdown, setShowMetaBreakdown] = useState(false); // Section 2 collapse
  
  const ecomLabel = store.ecommerce;
  
  const kpis = [
    { key: 'revenue', label: 'Revenue', value: overview.revenue, format: 'currency', color: '#8b5cf6' },
    { key: 'spend', label: 'Ad Spend', value: overview.spend, format: 'currency', color: '#6366f1' },
    { 
      key: 'orders',
      label: 'Orders',
      value: overview.orders,
      format: 'number',
      subtitle: `${overview.sallaOrders || overview.shopifyOrders || 0} ${ecomLabel} + ${overview.manualOrders} Manual`,
      color: '#22c55e'
    },
    { key: 'aov', label: 'AOV', value: overview.aov, format: 'currency', color: '#f59e0b' },
    { key: 'cac', label: 'CAC', value: overview.cac, format: 'currency', color: '#ef4444' },
    { key: 'roas', label: 'ROAS', value: overview.roas, format: 'roas', color: '#10b981' },
  ];

  const sortedCountries = [...countries].sort((a, b) => {
    const aVal = a[countrySortConfig.field] || 0;
    const bVal = b[countrySortConfig.field] || 0;
    return countrySortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const aVal = a[campaignSortConfig.field] || 0;
    const bVal = b[campaignSortConfig.field] || 0;
    return campaignSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const sortedBreakdownData = [...breakdownData].sort((a, b) => {
    const aVal = a[campaignSortConfig.field] || 0;
    const bVal = b[campaignSortConfig.field] || 0;
    return campaignSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const handleCountrySort = (field) => {
    setCountrySortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleCampaignSort = (field) => {
    setCampaignSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const getBreakdownLabel = (row, currentBreakdown) => {
    switch(currentBreakdown) {
      case 'country':
        return (
          <span className="flex items-center gap-2">
            <span>{row.countryFlag}</span> {row.countryName || row.country}
          </span>
        );
      case 'age':
        return (
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
            {row.age}
          </span>
        );
      case 'gender':
        return <span>{row.genderLabel || row.gender}</span>;
      case 'placement':
        return (
          <span className="text-xs">
            {row.placementLabel || `${row.platform} - ${row.placement}`}
          </span>
        );
      default:
        return null;
    }
  };

  const toggleKpi = (key) => {
    setExpandedKpis(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  };

  // SECTION 2 meta rows depending on breakdown
  const metaRows =
    breakdown === 'none' ? sortedCampaigns : sortedBreakdownData;

  const metaSpendTotal = metaRows.reduce((s, r) => s + (r.spend || 0), 0);
  const metaRevenueTotal = metaRows.reduce((s, r) => s + (r.conversionValue || 0), 0);
  const metaRoasTotal = metaSpendTotal > 0 ? metaRevenueTotal / metaSpendTotal : 0;
  const metaCampaignCount =
    breakdown === 'none'
      ? campaigns.length
      : new Set(metaRows.map(r => r.campaignId)).size;

  // SECTION 1 rows based on metaView
  const section1Rows =
    metaView === 'campaign' ? sortedCampaigns : sortedCountries;

  const section1Totals = (() => {
    const rows = section1Rows;
    const totalSpend = rows.reduce((s, r) => s + (r.spend || 0), 0);
    const totalMetaRevenue = rows.reduce(
      (s, r) => s + (metaView === 'campaign'
        ? (r.conversionValue || 0)
        : (r.revenue || 0)),
      0
    );
    const totalOrders = rows.reduce(
      (s, r) => s + (metaView === 'campaign'
        ? (r.conversions || 0)
        : (r.totalOrders || 0)),
      0
    );
    const totalImpr = rows.reduce((s, r) => s + (r.impressions || 0), 0);
    const totalReach = rows.reduce((s, r) => s + (r.reach || 0), 0);
    const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalLpv = rows.reduce((s, r) => s + (r.lpv || 0), 0);
    const totalAtc = rows.reduce((s, r) => s + (r.atc || 0), 0);
    const totalCheckout = rows.reduce((s, r) => s + (r.checkout || 0), 0);
    const totalMetaConversions = rows.reduce(
      (s, r) => s + (metaView === 'campaign'
        ? (r.conversions || 0)
        : (r.metaOrders || 0)),
      0
    );

    const roas = totalSpend > 0 ? totalMetaRevenue / totalSpend : 0;
    const aov = totalOrders > 0 ? totalMetaRevenue / totalOrders : 0;
    const cac = totalOrders > 0 ? totalSpend / totalOrders : 0;
    const cpm = totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0;
    const freq = totalReach > 0 ? totalImpr / totalReach : 0;
    const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const cr =
      totalClicks > 0
        ? (metaView === 'campaign'
            ? (totalMetaConversions / totalClicks) * 100
            : (totalOrders / totalClicks) * 100)
        : 0;

    return {
      totalSpend,
      totalMetaRevenue,
      totalOrders,
      totalImpr,
      totalReach,
      totalClicks,
      totalLpv,
      totalAtc,
      totalCheckout,
      totalMetaConversions,
      roas,
      aov,
      cac,
      cpm,
      freq,
      ctr,
      cpc,
      cr
    };
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI CARDS */}
      <div className="grid grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <KPICard 
            key={kpi.key}
            kpi={kpi}
            trends={trends}
            expanded={expandedKpis.includes(kpi.key)}
            onToggle={() => toggleKpi(kpi.key)}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>

      {/* Global Orders Trend */}
      {trends && trends.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Orders Trend</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area 
                  type="monotone" 
                  dataKey="orders" 
                  stroke="#22c55e"
                  fill="#22c55e"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Expanded KPI charts */}
      {expandedKpis.length > 0 && trends && trends.length > 0 && (
        <div className="space-y-6">
          {expandedKpis.map((key) => {
            const thisKpi = kpis.find(k => k.key === key);
            if (!thisKpi) return null;
            return (
              <div key={key} className="bg-white rounded-xl p-6 shadow-sm animate-fade-in">
                <h3 className="text-lg font-semibold mb-4">{thisKpi.label} Trend</h3>
                <div className="h-64">
                  <ResponsiveContainer>
                    <AreaChart data={trends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Area 
                        type="monotone" 
                        dataKey={key} 
                        stroke={thisKpi.color}
                        fill={thisKpi.color}
                        fillOpacity={0.2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION 1 — META FUNNEL (INTEGRATED) */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Section 1 — Meta Funnel (Shopify Data Included)</h2>
            <p className="text-xs text-gray-400">manual data included as well</p>
            <p className="text-sm text-gray-500">
              Meta funnel metrics with{" "}
              <span className="font-semibold">true revenue & orders</span> when
              you switch to By Country.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 mr-2">View:</span>
            <button
              onClick={() => setMetaView('campaign')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
                metaView === 'campaign'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Campaigns
            </button>
            <button
              onClick={() => setMetaView('country')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
                metaView === 'country'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              By Country (True)
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              {/* Highlight header row */}
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2">
                  {metaView === 'campaign' ? 'Campaign' : 'Country'}
                </th>
                <th colSpan={5} className="text-center border-l border-gray-100">
                  Meta Financials
                </th>
                <th colSpan={4} className="text-center border-l border-gray-100">
                  Upper Funnel
                </th>
                <th colSpan={4} className="text-center border-l border-gray-100">
                  Mid Funnel
                </th>
                <th colSpan={5} className="text-center border-l border-gray-100">
                  Lower Funnel
                </th>
              </tr>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <SortableHeader
                  label="Name"
                  field={metaView === 'campaign' ? 'campaignName' : 'name'}
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                  className="text-left px-4 py-2"
                />
                <SortableHeader
                  label="Spend"
                  field="spend"
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                />
                <th>Revenue</th>
                <SortableHeader
                  label="ROAS"
                  field={metaView === 'campaign' ? 'metaRoas' : 'roas'}
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                  className="bg-indigo-50 text-indigo-700"
                />
                <SortableHeader
                  label="AOV"
                  field={metaView === 'campaign' ? 'metaAov' : 'aov'}
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                  className="bg-indigo-50 text-indigo-700"
                />
                <SortableHeader
                  label="CAC"
                  field={metaView === 'campaign' ? 'metaCac' : 'cac'}
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                  className="bg-indigo-50 text-indigo-700"
                />

                <SortableHeader
                  label="Impr"
                  field="impressions"
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                />
                <SortableHeader
                  label="Reach"
                  field="reach"
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                />
                <th>CPM</th>
                <th>Freq</th>

                <SortableHeader
                  label="Clicks"
                  field="clicks"
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                />
                <th>CTR</th>
                <th>CPC</th>
                <th>LPV</th>

                <th>ATC</th>
                <th>Checkout</th>
                <th>Orders</th>
                <SortableHeader
                  label="Conv"
                  field={metaView === 'campaign' ? 'conversions' : 'metaOrders'}
                  sortConfig={metaView === 'campaign' ? campaignSortConfig : countrySortConfig}
                  onSort={metaView === 'campaign' ? handleCampaignSort : handleCountrySort}
                />
                <th>CR</th>
              </tr>
            </thead>
            <tbody>
              {section1Rows.map((row) => {
                const isCampaign = metaView === 'campaign';
                const nameCell = isCampaign ? (
                  <span className="font-medium">{row.campaignName}</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{row.flag}</span>
                    <span className="font-medium">{row.name}</span>
                  </div>
                );

                const revenueCell = isCampaign
                  ? formatCurrency(row.conversionValue || 0)
                  : formatCurrency(row.revenue || 0);

                const roas = isCampaign ? row.metaRoas || 0 : row.roas || 0;
                const aov = isCampaign ? row.metaAov || 0 : row.aov || 0;
                const cac = isCampaign ? row.metaCac || 0 : row.cac || 0;

                const orders = isCampaign
                  ? row.conversions || 0
                  : row.totalOrders || 0;

                const metaConv = isCampaign
                  ? row.conversions || 0
                  : row.metaOrders || 0;

                const cr =
                  row.clicks > 0
                    ? (isCampaign
                        ? (metaConv / row.clicks) * 100
                        : (orders / row.clicks) * 100)
                    : 0;

                return (
                  <tr key={isCampaign ? row.campaignId : row.code}>
                    <td className="px-4 py-2">{nameCell}</td>
                    <td className="text-indigo-600 font-semibold">
                      {formatCurrency(row.spend || 0)}
                    </td>
                    <td className="text-green-600 font-semibold">{revenueCell}</td>
                    <td className="text-green-600 font-semibold">
                      {roas.toFixed(2)}×
                    </td>
                    <td>{formatCurrency(aov || 0)}</td>
                    <td className={cac > 100 ? 'text-amber-600 font-medium' : ''}>
                      {formatCurrency(cac || 0)}
                    </td>

                    <td>{formatNumber(row.impressions || 0)}</td>
                    <td>{formatNumber(row.reach || 0)}</td>
                    <td>{formatCurrency(row.cpm || 0, 2)}</td>
                    <td>{(row.frequency || 0).toFixed(2)}</td>

                    <td>{formatNumber(row.clicks || 0)}</td>
                    <td>{(row.ctr || 0).toFixed(2)}%</td>
                    <td>{formatCurrency(row.cpc || 0, 2)}</td>
                    <td>{formatNumber(row.lpv || 0)}</td>

                    <td>{formatNumber(row.atc || 0)}</td>
                    <td>{formatNumber(row.checkout || 0)}</td>
                    <td>{orders}</td>
                    <td>{metaConv}</td>
                    <td>{cr.toFixed(2)}%</td>
                  </tr>
                );
              })}

              {/* TOTAL ROW */}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2">
                  {metaView === 'campaign' ? 'TOTAL (Campaigns)' : 'TOTAL (Countries)'}
                </td>
                <td className="text-indigo-600">
                  {formatCurrency(section1Totals.totalSpend)}
                </td>
                <td className="text-green-600">
                  {formatCurrency(section1Totals.totalMetaRevenue)}
                </td>
                <td className="text-green-600">
                  {section1Totals.roas.toFixed(2)}×
                </td>
                <td>{formatCurrency(section1Totals.aov || 0)}</td>
                <td>{formatCurrency(section1Totals.cac || 0)}</td>

                <td>{formatNumber(section1Totals.totalImpr)}</td>
                <td>{formatNumber(section1Totals.totalReach)}</td>
                <td>{formatCurrency(section1Totals.cpm || 0, 2)}</td>
                <td>{section1Totals.freq.toFixed(2)}</td>

                <td>{formatNumber(section1Totals.totalClicks)}</td>
                <td>{section1Totals.ctr.toFixed(2)}%</td>
                <td>{formatCurrency(section1Totals.cpc || 0, 2)}</td>
                <td>{formatNumber(section1Totals.totalLpv)}</td>

                <td>{formatNumber(section1Totals.totalAtc)}</td>
                <td>{formatNumber(section1Totals.totalCheckout)}</td>
                <td>{section1Totals.totalOrders}</td>
                <td>{section1Totals.totalMetaConversions}</td>
                <td>{section1Totals.cr.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Countries Performance (true world, same as before) */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold">Countries Performance</h2>
          <p className="text-sm text-gray-500">
            Combined: Meta Spend + {store.ecommerce} Orders + Manual Orders • Click
            headers to sort
          </p>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Country</th>
                <SortableHeader
                  label="Spend"
                  field="spend"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
                <SortableHeader
                  label="Revenue"
                  field="revenue"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
                <SortableHeader
                  label="Share"
                  field="spend"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
                <SortableHeader
                  label="Orders"
                  field="totalOrders"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
                <SortableHeader
                  label="AOV"
                  field="aov"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
                <SortableHeader
                  label="CAC"
                  field="cac"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
                <SortableHeader
                  label="ROAS"
                  field="roas"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                />
              </tr>
            </thead>
            <tbody>
              {sortedCountries.map((c) => {
                const totalSpend = countries.reduce((s, x) => s + (x.spend || 0), 0);
                const share = totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0;
                return (
                  <tr key={c.code}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{c.flag}</span>
                        <div>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-gray-400">{c.code}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-indigo-600 font-semibold">
                      {formatCurrency(c.spend)}
                    </td>
                    <td className="text-green-600 font-semibold">
                      {formatCurrency(c.revenue || 0)}
                    </td>
                    <td>{share.toFixed(0)}%</td>
                    <td>
                      <span className="badge badge-green">{c.totalOrders}</span>
                    </td>
                    <td>{formatCurrency(c.aov)}</td>
                    <td className={c.cac > 80 ? 'text-amber-600 font-medium' : ''}>
                      {formatCurrency(c.cac, 2)}
                    </td>
                    <td className="text-green-600 font-semibold">
                      {c.roas.toFixed(2)}×
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2 — PURE META BREAKDOWN WORLD */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setShowMetaBreakdown(!showMetaBreakdown)}
          className="w-full px-6 pt-5 pb-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
        >
          <div>
            <h2 className="text-lg font-semibold">Section 2 — Pure Meta Breakdown World</h2>
            <p className="text-sm text-gray-500">
              Detailed Meta campaign & breakdown metrics. Click to{" "}
              {showMetaBreakdown ? 'collapse' : 'expand'}.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>Campaigns: <strong>{metaCampaignCount}</strong></span>
            <span>Spend: <strong>{formatCurrency(metaSpendTotal)}</strong></span>
            <span>Meta Rev: <strong>{formatCurrency(metaRevenueTotal)}</strong></span>
            <span>ROAS: <strong>{metaRoasTotal.toFixed(2)}×</strong></span>
            <ChevronDown
              className={`w-5 h-5 text-gray-500 transform transition-transform ${
                showMetaBreakdown ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {showMetaBreakdown && (
          <>
            <div className="px-6 pt-4 pb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-400">
                Meta Campaign Performance <span className="ml-2 text-gray-300">PURE META</span>
              </div>
              <select 
                value={breakdown}
                onChange={(e) => setBreakdown(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
              >
                <option value="none">No Breakdown</option>
                <option value="country">By Country</option>
                <option value="age">By Age</option>
                <option value="gender">By Gender</option>
                <option value="placement">By Placement</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Campaign</th>
                    {breakdown !== 'none' && <th>{breakdown}</th>}
                    <th>Spend</th>
                    <th className="bg-indigo-50 text-indigo-700">ROAS</th>
                    <th className="bg-indigo-50 text-indigo-700">AOV</th>
                    <th className="bg-indigo-50 text-indigo-700">CAC</th>
                    <th>Impr</th>
                    <th>Reach</th>
                    <th>CPM</th>
                    <th>Freq</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>CPC</th>
                    <th>Conv</th>
                    <th>CR</th>
                  </tr>
                </thead>
                <tbody>
                  {metaRows.map((c, idx) => (
                    <tr key={`${c.campaignId}-${idx}`}>
                      <td className="px-4 py-2 font-medium">{c.campaignName}</td>
                      {breakdown !== 'none' && (
                        <td>{getBreakdownLabel(c, breakdown)}</td>
                      )}
                      <td className="text-indigo-600 font-semibold">
                        {formatCurrency(c.spend)}
                      </td>
                      <td className="text-green-600 font-semibold">
                        {(c.metaRoas || 0).toFixed(2)}×
                      </td>
                      <td>{formatCurrency(c.metaAov || 0)}</td>
                      <td className={(c.metaCac || 0) > 100 ? 'text-amber-600' : ''}>
                        {formatCurrency(c.metaCac || 0)}
                      </td>
                      <td>{formatNumber(c.impressions || 0)}</td>
                      <td>{formatNumber(c.reach || 0)}</td>
                      <td>{formatCurrency(c.cpm || 0, 2)}</td>
                      <td>{(c.frequency || 0).toFixed(2)}</td>
                      <td>{formatNumber(c.clicks || 0)}</td>
                      <td>{(c.ctr || 0).toFixed(2)}%</td>
                      <td>{formatCurrency(c.cpc || 0, 2)}</td>
                      <td>{c.conversions || 0}</td>
                      <td>{(c.cr || 0).toFixed(2)}%</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-4 py-2">
                      TOTAL
                    </td>
                    {breakdown !== 'none' && <td></td>}
                    <td className="text-indigo-600">
                      {formatCurrency(metaSpendTotal)}
                    </td>
                    <td className="text-green-600">
                      {metaRoasTotal.toFixed(2)}×
                    </td>
                    <td colSpan={11}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Funnel Diagnostics */}
      {diagnostics && diagnostics.length > 0 && (
        <div
          className={`rounded-xl p-6 ${
            diagnostics.some(d => d.type === 'warning') 
              ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200'
              : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'
          }`}
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            🔍 Funnel Diagnostics
          </h3>
          <div className="space-y-3">
            {diagnostics.map((d, i) => (
              <div key={i} className="flex gap-3 p-4 bg-white/70 rounded-lg">
                <span className="text-xl">{d.icon}</span>
                <div>
                  <p className="font-medium">{d.title}</p>
                  <p className="text-sm text-gray-600">{d.detail}</p>
                  <p className="text-sm text-indigo-600 mt-1">{d.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Country order trends (collapsible) */}
      {countryTrends && countryTrends.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <button
            onClick={() => setShowCountryTrends(!showCountryTrends)}
            className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div>
              <h2 className="text-lg font-semibold text-left">Order Trends by Country</h2>
              <p className="text-sm text-gray-500 text-left">
                Click to {showCountryTrends ? 'collapse' : 'expand'} daily order trends
                per country
              </p>
            </div>
            <div
              className={`transform transition-transform ${
                showCountryTrends ? 'rotate-180' : ''
              }`}
            >
              <ChevronDown className="w-5 h-5 text-gray-500" />
            </div>
          </button>
          
          {showCountryTrends && (
            <div className="p-6 pt-0 space-y-6">
              {countryTrends.slice(0, 5).map((country) => (
                <div
                  key={country.countryCode}
                  className="border-t border-gray-100 pt-4 first:border-0 first:pt-0"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">{country.flag}</span>
                    <span className="font-semibold">{country.country}</span>
                    <span className="text-sm text-gray-500">
                      ({country.totalOrders} orders)
                    </span>
                  </div>
                  <div className="h-32">
                    <ResponsiveContainer>
                      <AreaChart data={country.trends}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="date" 
                          tick={{ fontSize: 10 }}
                          tickFormatter={(d) =>
                            new Date(d).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric'
                            })
                          }
                        />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip 
                          labelFormatter={(d) =>
                            new Date(d).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric'
                            })
                          }
                          formatter={(value, name) => [
                            value,
                            name === 'orders' ? 'Orders' : 'Revenue'
                          ]}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="orders" 
                          stroke="#6366f1"
                          fill="#6366f1"
                          fillOpacity={0.2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
              {countryTrends.length > 5 && (
                <p className="text-sm text-gray-500 text-center pt-2">
                  Showing top 5 countries by orders. {countryTrends.length - 5} more
                  countries available.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Debug panel */}
      <div className="bg-gray-900 text-gray-100 rounded-xl p-4 mt-6 text-sm">
        <h3 className="font-semibold mb-2">Debug · Meta vs Dashboard</h3>
        <p>
          Store: <span className="font-mono">{store.id}</span>
        </p>
        <p>
          Date range (API):{' '}
          <span className="font-mono">
            {dashboard?.dateRange?.startDate} → {dashboard?.dateRange?.endDate}
          </span>
        </p>

        <div className="grid grid-cols-2 gap-4 mt-3">
          <div>
            <p className="text-xs text-gray-400 uppercase mb-1">Campaigns</p>
            <p>
              Total rows: <span className="font-mono">{campaigns.length}</span>
            </p>
            <p>
              Spend (sum of campaigns):{' '}
              <span className="font-mono">
                {formatCurrency(
                  campaigns.reduce((s, c) => s + (c.spend || 0), 0)
                )}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase mb-1">Overview</p>
            <p>
              Overview spend:{' '}
              <span className="font-mono">
                {formatCurrency(overview.spend || 0)}
              </span>
            </p>
            <p>
              Overview revenue:{' '}
              <span className="font-mono">
                {formatCurrency(overview.revenue || 0)}
              </span>
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          If campaign spend is far below Ads Manager, suspect pagination, date
          filters, or currency conversion.
        </p>
      </div>
    </div>
  );
}

function KPICard({ kpi, trends, expanded, onToggle, formatCurrency }) {
  const trendData = trends && trends.length > 0
    ? trends.slice(-7).map(t => ({ value: t[kpi.key] || 0 }))
    : [];
  
  const calculateChange = () => {
    if (!trends || trends.length < 2) return { value: 0, isPositive: true };
    
    const midPoint = Math.floor(trends.length / 2);
    const firstHalf = trends.slice(0, midPoint);
    const secondHalf = trends.slice(midPoint);
    
    const firstSum = firstHalf.reduce((sum, t) => sum + (t[kpi.key] || 0), 0);
    const secondSum = secondHalf.reduce((sum, t) => sum + (t[kpi.key] || 0), 0);
    
    const firstAvg = firstHalf.length > 0 ? firstSum / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondSum / secondHalf.length : 0;
    
    if (firstAvg === 0) return { value: 0, isPositive: true };
    
    const change = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    const isGoodChange = kpi.key === 'cac' || kpi.key === 'spend' 
      ? change < 0 
      : change > 0;
    
    return { value: Math.abs(change), isPositive: change >= 0, isGood: isGoodChange };
  };
  
  const change = calculateChange();
  
  const formatValue = () => {
    if (kpi.format === 'currency') return formatCurrency(kpi.value);
    if (kpi.format === 'roas') return (kpi.value || 0).toFixed(2) + '×';
    return Math.round(kpi.value || 0);
  };

  return (
    <div 
      onClick={onToggle}
      className={`bg-white rounded-xl p-5 shadow-sm cursor-pointer card-hover ${
        expanded ? 'ring-2 ring-indigo-500' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {kpi.label}
        </span>
        {change.value > 0 && (
          <span
            className={`flex items-center gap-1 text-xs font-medium ${
              change.isGood ? 'text-green-600' : 'text-red-500'
            }`}
          >
            {change.isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {change.value.toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-1">
        {formatValue()}
      </div>
      {kpi.subtitle && (
        <div className="text-xs text-gray-400">{kpi.subtitle}</div>
      )}
      
      {trendData.length > 0 && (
        <div className="h-10 mt-3">
          <ResponsiveContainer>
            <LineChart data={trendData}>
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke={kpi.color} 
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="text-xs text-gray-400 mt-1 text-center">
        {expanded ? 'Click to hide chart' : 'Click to expand'}
      </div>
    </div>
  );
}

function EfficiencyTab({ efficiency, trends, recommendations, formatCurrency }) {
  const statusColors = {
    green: { bg: 'bg-green-100', text: 'text-green-700', label: 'Healthy' },
    yellow: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Moderate Pressure' },
    red: { bg: 'bg-red-100', text: 'text-red-700', label: 'High Pressure' }
  };
  
  const status = statusColors[efficiency.status] || statusColors.yellow;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${status.bg}`}>
              {efficiency.status === 'green' ? '✅' : efficiency.status === 'red' ? '🔴' : '⚠️'}
            </div>
            <div>
              <h3 className="font-semibold text-lg">{status.label}</h3>
              <p className="text-sm text-gray-500">Overall efficiency status</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="font-semibold mb-4">Average vs Marginal CAC</h3>
          <div className="space-y-3">
            <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Average CAC</span>
              <span className="font-semibold text-green-600">
                {formatCurrency(efficiency.averageCac, 2)}
              </span>
            </div>
            <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Marginal CAC</span>
              <span className="font-semibold">
                {formatCurrency(efficiency.marginalCac, 2)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="font-semibold mb-4">Scaling Headroom</h3>
          <div className="space-y-2">
            {efficiency.countries && efficiency.countries.map(c => (
              <div
                key={c.code}
                className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
              >
                <span className="text-sm">
                  {c.scaling === 'green' ? '🟢' : c.scaling === 'yellow' ? '🟡' : '🔴'}{' '}
                  {c.name}
                </span>
                <span
                  className={`text-sm font-medium ${
                    c.scaling === 'green'
                      ? 'text-green-600'
                      : c.scaling === 'yellow'
                      ? 'text-amber-600'
                      : 'text-red-600'
                  }`}
                >
                  {c.headroom}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {trends && trends.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold mb-4">CAC Trend</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="cac"
                    name="Daily CAC"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold mb-4">ROAS Trend</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="roas"
                    name="Daily ROAS"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">💡 Recommendations</h3>
        <div className="space-y-3">
          {recommendations.map((r, i) => (
            <div 
              key={i}
              className={`flex gap-4 p-4 rounded-xl border-l-4 ${
                r.type === 'urgent'
                  ? 'bg-red-50 border-red-500'
                  : r.type === 'positive'
                  ? 'bg-green-50 border-green-500'
                  : 'bg-gray-50 border-indigo-500'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  r.type === 'urgent'
                    ? 'bg-red-500'
                    : r.type === 'positive'
                    ? 'bg-green-500'
                    : 'bg-indigo-500'
                }`}
              >
                {i + 1}
              </div>
              <div className="flex-1">
                <h4 className="font-semibold">{r.title}</h4>
                <p className="text-sm text-gray-600 mt-1">{r.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ManualDataTab({
  orders,
  form,
  setForm,
  onSubmit,
  onDelete,
  onBulkDelete,
  formatCurrency,
  store,
  availableCountries
}) {
  const [deleteScope, setDeleteScope] = useState('day');
  const [deleteDate, setDeleteDate] = useState(new Date().toISOString().split('T')[0]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Manual Order
        </h3>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-6 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Country
              </label>
              <select
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              >
                {availableCountries.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Campaign
              </label>
              <input
                type="text"
                value={form.campaign}
                onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                placeholder="Campaign name"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                # Orders
              </label>
              <input
                type="number"
                min="1"
                value={form.orders_count}
                onChange={(e) =>
                  setForm({ ...form, orders_count: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Revenue ({store.currencySymbol})
              </label>
              <input
                type="number"
                min="0"
                value={form.revenue}
                onChange={(e) =>
                  setForm({ ...form, revenue: parseFloat(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source
              </label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="correction">Meta Correction</option>
                <option value="phone">Phone Call</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="px-6 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Add Order
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Manual Orders History</h3>
        {orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-3">📋</p>
            <p>No manual orders added yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 border-indigo-500"
              >
                <div className="flex items-center gap-6">
                  <span className="font-medium">{order.date}</span>
                  <span className="px-2 py-1 bg-gray-200 rounded text-sm">
                    {order.country}
                  </span>
                  <span className="px-2 py-1 bg-gray-200 rounded text-sm capitalize">
                    {order.source}
                  </span>
                  <span>
                    <strong>{order.orders_count}</strong> orders •{' '}
                    <span className="text-green-600 font-medium">
                      {formatCurrency(order.revenue)}
                    </span>
                  </span>
                </div>
                <button
                  onClick={() => onDelete(order.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-red-700 mb-4 flex items-center gap-2">
          <Trash2 className="w-5 h-5" />
          Delete Manual Data
        </h3>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Delete data for
            </label>
            <select
              value={deleteScope}
              onChange={(e) => setDeleteScope(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg"
            >
              <option value="day">Specific Day</option>
              <option value="week">Specific Week</option>
              <option value="month">Specific Month</option>
              <option value="all">All Manual Data</option>
            </select>
          </div>
          {deleteScope !== 'all' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date
              </label>
              <input
                type="date"
                value={deleteDate}
                onChange={(e) => setDeleteDate(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
          )}
          <button
            onClick={() => onBulkDelete(deleteScope, deleteDate)}
            className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
