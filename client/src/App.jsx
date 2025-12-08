// client/src/App.jsx

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import {
  RefreshCw, TrendingUp, TrendingDown, Plus, Trash2,
  Store, ChevronDown, ChevronUp, ArrowUpDown, Calendar,
  Bell, X, AlertCircle, CheckCircle2
} from 'lucide-react';
import { COUNTRIES as MASTER_COUNTRIES } from './data/countries';
import NotificationCenter from './components/NotificationCenter';

const API_BASE = '/api';

const getLocalDateString = (date = new Date()) => {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(date.getTime() - offsetMs);
  return localDate.toISOString().split('T')[0];
};

const countryCodeToFlag = (code) => {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return '🏳️';
  return String.fromCodePoint(...code.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0)));
};

const MASTER_COUNTRIES_WITH_FLAGS = MASTER_COUNTRIES.map(country => ({
  ...country,
  flag: countryCodeToFlag(country.code)
}));

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

const TABS = ['Dashboard', 'Budget Efficiency', 'Budget Intelligence', 'Manual Data'];

export default function App() {
  const [currentStore, setCurrentStore] = useState('vironax');
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  
  const [dateRange, setDateRange] = useState({ type: 'days', value: 7 });
  const [customRange, setCustomRange] = useState({
    start: getLocalDateString(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)),
    end: getLocalDateString()
  });
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  
  const [dashboard, setDashboard] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [efficiencyTrends, setEfficiencyTrends] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [budgetIntelligence, setBudgetIntelligence] = useState(null);
  const [manualOrders, setManualOrders] = useState([]);
  const [manualSpendOverrides, setManualSpendOverrides] = useState([]);
  const [availableCountries, setAvailableCountries] = useState([]);
  const [metaBreakdownData, setMetaBreakdownData] = useState([]);
  const [timeOfDay, setTimeOfDay] = useState({ data: [], timezone: 'America/Chicago', sampleTimestamps: [], source: '' });
  const [selectedShopifyRegion, setSelectedShopifyRegion] = useState('us');
  // Days of week
  const [daysOfWeek, setDaysOfWeek] = useState({ data: [], source: '', totalOrders: 0, period: '14d' });
  const [daysOfWeekPeriod, setDaysOfWeekPeriod] = useState('14d');
  // KPI charts
  const [expandedKpis, setExpandedKpis] = useState([]);
  // Section 2 breakdown (pure meta)
  const [metaBreakdown, setMetaBreakdown] = useState('none');
  // Country trends
  const [countryTrends, setCountryTrends] = useState([]);
  const [countryTrendsDataSource, setCountryTrendsDataSource] = useState('');
  const [countriesDataSource, setCountriesDataSource] = useState('');

  // Unified analytics section state (must be before useEffect hooks that use them)
  const [analyticsMode, setAnalyticsMode] = useState('countries'); // 'countries' | 'meta-ad-manager'
  const [metaAdManagerData, setMetaAdManagerData] = useState([]);
  const [adManagerBreakdown, setAdManagerBreakdown] = useState('none'); // 'none', 'country', 'age', 'gender', 'age_gender', 'placement'
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());
  const [expandedAdsets, setExpandedAdsets] = useState(new Set());

  // Funnel diagnostics state
  const [funnelDiagnostics, setFunnelDiagnostics] = useState(null);

  const store = STORES[currentStore];
  const [orderForm, setOrderForm] = useState({
    date: getLocalDateString(),
    country: 'SA',
    campaign: '',
    spend: 0,
    orders_count: 1,
    revenue: 280,
    source: 'whatsapp',
    notes: ''
  });
  const [spendOverrideForm, setSpendOverrideForm] = useState({
    date: getLocalDateString(),
    country: 'ALL',
    amount: 0,
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
      const countryTrendParams = new URLSearchParams({ store: currentStore, days: 7 });
      
      // Fix 7: Always show arrows for comparison (Today compares to Yesterday, Yesterday compares to day before)
      const shouldShowArrows = true;
      
      if (dateRange.type === 'custom') {
        params.set('startDate', dateRange.start);
        params.set('endDate', dateRange.end);
        countryTrendParams.set('startDate', dateRange.start);
        countryTrendParams.set('endDate', dateRange.end);
      } else if (dateRange.type === 'yesterday') {
        params.set('yesterday', '1');
        countryTrendParams.set('yesterday', '1');
      } else {
        params.set(dateRange.type, dateRange.value);
        countryTrendParams.set(dateRange.type, dateRange.value);
      }
      
      params.set('showArrows', shouldShowArrows);

      const shopifyRegion = selectedShopifyRegion ?? 'us';
      const timeOfDayParams = new URLSearchParams({ store: currentStore, days: 7, region: shopifyRegion });

      const [
        dashData,
        effData,
        effTrends,
        recs,
        intel,
        orders,
        spendOverrides,
        countries,
        cTrends,
        timeOfDayData,
        dowData
      ] = await Promise.all([
        fetch(`${API_BASE}/analytics/dashboard?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/efficiency?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/efficiency/trends?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/recommendations?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/budget-intelligence?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/manual?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/manual/spend?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/countries?store=${currentStore}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/countries/trends?${countryTrendParams}`).then(r => r.json()),
        // Time of day - now fetches for both stores
        fetch(`${API_BASE}/analytics/time-of-day?${timeOfDayParams}`).then(r => r.json()),
        // Days of week
        fetch(`${API_BASE}/analytics/days-of-week?store=${currentStore}&period=${daysOfWeekPeriod}`).then(r => r.json())
      ]);

      setDashboard(dashData);
      setEfficiency(effData);
      setEfficiencyTrends(effTrends);
      setRecommendations(recs);
      setBudgetIntelligence(intel);
      setManualOrders(orders);
      setManualSpendOverrides(spendOverrides);

      const safeCountries = (Array.isArray(countries) && countries.length > 0)
        ? countries.map(country => ({ ...country, flag: country.flag || countryCodeToFlag(country.code) }))
        : MASTER_COUNTRIES_WITH_FLAGS;

      setAvailableCountries(safeCountries);
      setOrderForm(prev =>
        safeCountries.some(c => c.code === prev.country)
          ? prev
          : { ...prev, country: safeCountries[0]?.code || prev.country }
      );

      setSpendOverrideForm(prev => {
        if (prev.country === 'ALL') return prev;
        return safeCountries.some(c => c.code === prev.country)
          ? prev
          : { ...prev, country: safeCountries[0]?.code || prev.country };
      });

      // Handle country trends - now returns { data: [...], dataSource: ... }
      if (cTrends && typeof cTrends === 'object' && Array.isArray(cTrends.data)) {
        setCountryTrends(cTrends.data);
        setCountryTrendsDataSource(cTrends.dataSource || '');
      } else if (Array.isArray(cTrends)) {
        // Backwards compatibility
        setCountryTrends(cTrends);
        setCountryTrendsDataSource('');
      } else {
        setCountryTrends([]);
        setCountryTrendsDataSource('');
      }

      // Set countries data source from dashboard
      setCountriesDataSource(dashData?.countriesDataSource || '');

      // Set time of day data
      const todData = Array.isArray(timeOfDayData?.data) ? timeOfDayData.data : [];
      const todZone = typeof timeOfDayData?.timezone === 'string' ? timeOfDayData.timezone : null;
      const todSamples = Array.isArray(timeOfDayData?.sampleTimestamps) ? timeOfDayData.sampleTimestamps.slice(0, 5) : [];
      const todSource = timeOfDayData?.source || '';
      const todMessage = timeOfDayData?.message || '';
      const fallbackTimezone = shopifyRegion === 'europe' ? 'Europe/London' : shopifyRegion === 'all' ? 'UTC' : 'America/Chicago';
      const safeTimezone = todZone || fallbackTimezone;
      setTimeOfDay({ data: todData, timezone: safeTimezone, sampleTimestamps: todSamples, source: todSource, message: todMessage });

      // Set days of week data
      setDaysOfWeek(dowData || { data: [], source: '', totalOrders: 0, period: '14d' });
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  }, [currentStore, dateRange, selectedShopifyRegion, daysOfWeekPeriod]);

  useEffect(() => {
    if (storeLoaded) {
      loadData();
    }
  }, [loadData, storeLoaded]);

  // Load breakdown data for Section 2 (pure meta)
  useEffect(() => {
    if (!storeLoaded) return;

    async function loadBreakdown() {
      if (metaBreakdown === 'none') {
        setMetaBreakdownData([]);
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

        const endpoint = metaBreakdown === 'age_gender'
          ? `${API_BASE}/analytics/campaigns/by-age-gender?${params}`
          : `${API_BASE}/analytics/campaigns/by-${metaBreakdown}?${params}`;
        const data = await fetch(endpoint).then(r => r.json());
        setMetaBreakdownData(data);
      } catch (error) {
        console.error('Error loading breakdown:', error);
        setMetaBreakdownData([]);
      }
    }

    loadBreakdown();
  }, [metaBreakdown, currentStore, dateRange, storeLoaded]);

  // Load Meta Ad Manager hierarchy data
  useEffect(() => {
    if (!storeLoaded || analyticsMode !== 'meta-ad-manager') return;

    async function loadMetaAdManager() {
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

        if (adManagerBreakdown !== 'none') {
          params.set('breakdown', adManagerBreakdown);
        }

        const data = await fetch(`${API_BASE}/analytics/meta-ad-manager?${params}`).then(r => r.json());
        setMetaAdManagerData(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error loading Meta Ad Manager data:', error);
        setMetaAdManagerData([]);
      }
    }

    loadMetaAdManager();
  }, [analyticsMode, adManagerBreakdown, currentStore, dateRange, storeLoaded]);

  // Load funnel diagnostics data
  useEffect(() => {
    if (!storeLoaded || !currentStore) return;

    const fetchDiagnostics = async () => {
      try {
        const params = new URLSearchParams({
          store: currentStore
        });

        if (dateRange.type === 'custom') {
          params.set('startDate', dateRange.start);
          params.set('endDate', dateRange.end);
        } else if (dateRange.type === 'yesterday') {
          // For yesterday, calculate the date
          const yesterday = getLocalDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
          params.set('startDate', yesterday);
          params.set('endDate', yesterday);
        } else {
          // Calculate date range based on type (days, weeks, months)
          const days = dateRange.type === 'months' ? dateRange.value * 30 :
                       dateRange.type === 'weeks' ? dateRange.value * 7 :
                       dateRange.value;
          const endDate = getLocalDateString();
          const startDate = getLocalDateString(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
          params.set('startDate', startDate);
          params.set('endDate', endDate);
        }

        const res = await fetch(`${API_BASE}/analytics/funnel-diagnostics?${params}`);
        const json = await res.json();
        if (json.success) {
          setFunnelDiagnostics(json.data);
        }
      } catch (error) {
        console.error('Error fetching funnel diagnostics:', error);
      }
    };

    fetchDiagnostics();
  }, [currentStore, dateRange, storeLoaded]);

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
        spend: 0,
        orders_count: 1,
        revenue: STORES[currentStore].defaultAOV,
        notes: ''
      }));
      await loadData();
    } catch (error) {
      console.error('Error adding order:', error);
    }
  }

  async function handleAddSpendOverride(e) {
    e.preventDefault();
    try {
      await fetch(`${API_BASE}/manual/spend?store=${currentStore}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spendOverrideForm)
      });
      setSpendOverrideForm(prev => ({
        ...prev,
        amount: 0,
        notes: ''
      }));
      loadData();
    } catch (error) {
      console.error('Error adding spend override:', error);
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

  async function handleDeleteSpendOverride(id) {
    if (!confirm('Delete this manual spend entry?')) return;
    try {
      await fetch(`${API_BASE}/manual/spend/${id}`, { method: 'DELETE' });
      loadData();
    } catch (error) {
      console.error('Error deleting manual spend:', error);
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
              <NotificationCenter currentStore={currentStore} />
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
                      max={customRange.end || getLocalDateString()}
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
                      max={getLocalDateString()}
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
            metaBreakdown={metaBreakdown}
            setMetaBreakdown={setMetaBreakdown}
            metaBreakdownData={metaBreakdownData}
            store={store}
            countryTrends={countryTrends}
            countryTrendsDataSource={countryTrendsDataSource}
            countriesDataSource={countriesDataSource}
            timeOfDay={timeOfDay}
            selectedShopifyRegion={selectedShopifyRegion}
            setSelectedShopifyRegion={setSelectedShopifyRegion}
            daysOfWeek={daysOfWeek}
            daysOfWeekPeriod={daysOfWeekPeriod}
            setDaysOfWeekPeriod={setDaysOfWeekPeriod}
            loading={loading}
            analyticsMode={analyticsMode}
            setAnalyticsMode={setAnalyticsMode}
            metaAdManagerData={metaAdManagerData}
            adManagerBreakdown={adManagerBreakdown}
            setAdManagerBreakdown={setAdManagerBreakdown}
            expandedCampaigns={expandedCampaigns}
            setExpandedCampaigns={setExpandedCampaigns}
            expandedAdsets={expandedAdsets}
            setExpandedAdsets={setExpandedAdsets}
            funnelDiagnostics={funnelDiagnostics}
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

        {activeTab === 2 && budgetIntelligence && (
          <BudgetIntelligenceTab
            data={budgetIntelligence}
            formatCurrency={formatCurrency}
            store={store}
          />
        )}

        {activeTab === 3 && (
          <ManualDataTab
            orders={manualOrders}
            form={orderForm}
            setForm={setOrderForm}
            onSubmit={handleAddOrder}
            onDelete={handleDeleteOrder}
            manualSpendOverrides={manualSpendOverrides}
            spendOverrideForm={spendOverrideForm}
            setSpendOverrideForm={setSpendOverrideForm}
            onAddSpendOverride={handleAddSpendOverride}
            onDeleteSpendOverride={handleDeleteSpendOverride}
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
  dashboard = {},
  expandedKpis = [],
  setExpandedKpis = () => {},
  formatCurrency = () => 0,
  formatNumber = () => 0,
  metaBreakdown = 'none',
  setMetaBreakdown = () => {},
  metaBreakdownData = [],
  store = {},
  countryTrends = [],
  countryTrendsDataSource = '',
  countriesDataSource = '',
  timeOfDay = { data: [], timezone: 'America/Chicago', sampleTimestamps: [], source: '' },
  selectedShopifyRegion = 'us',
  setSelectedShopifyRegion = () => {},
  daysOfWeek = { data: [], source: '', totalOrders: 0, period: '14d' },
  daysOfWeekPeriod = '14d',
  setDaysOfWeekPeriod = () => {},
  loading = false,
  analyticsMode = 'countries',
  setAnalyticsMode = () => {},
  metaAdManagerData = [],
  adManagerBreakdown = 'none',
  setAdManagerBreakdown = () => {},
  expandedCampaigns = new Set(),
  setExpandedCampaigns = () => {},
  expandedAdsets = new Set(),
  setExpandedAdsets = () => {},
  funnelDiagnostics = null,
}) {
  const { overview = {}, trends = {}, campaigns = [], countries = [], diagnostics = {} } = dashboard || {};

  const [countrySortConfig, setCountrySortConfig] = useState({ field: 'totalOrders', direction: 'desc' });
  const [campaignSortConfig, setCampaignSortConfig] = useState({ field: 'spend', direction: 'desc' });
  const [showCountryTrends, setShowCountryTrends] = useState(false);
  const [metaView, setMetaView] = useState('campaign'); // 'campaign' | 'country'
  const [showMetaBreakdown, setShowMetaBreakdown] = useState(false); // Section 2 collapse
  const [expandedCountries, setExpandedCountries] = useState(new Set());
  const [expandedStates, setExpandedStates] = useState(new Set());

  const ecomLabel = store.ecommerce;
  
  const kpis = [
    { key: 'revenue', label: 'Revenue', value: overview.revenue, change: overview.revenueChange, format: 'currency', color: '#8b5cf6' },
    { key: 'spend', label: 'Ad Spend', value: overview.spend, change: overview.spendChange, format: 'currency', color: '#6366f1' },
    { key: 'orders', label: 'Orders', value: overview.orders, change: overview.ordersChange, format: 'number', color: '#22c55e' },
    { key: 'aov', label: 'AOV', value: overview.aov, change: overview.aovChange, format: 'currency', color: '#f59e0b' },
    { key: 'cac', label: 'CAC', value: overview.cac, change: overview.cacChange, format: 'currency', color: '#ef4444' },
    { key: 'roas', label: 'ROAS', value: overview.roas, change: overview.roasChange, format: 'roas', color: '#10b981' },
  ];

  const sortedCountries = [...countries].sort((a, b) => {
    const aVal = a[countrySortConfig.field] || 0;
    const bVal = b[countrySortConfig.field] || 0;
    return countrySortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const totalCountrySpend = countries.reduce((s, x) => s + (x.spend || 0), 0);

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const aVal = a[campaignSortConfig.field] || 0;
    const bVal = b[campaignSortConfig.field] || 0;
    return campaignSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const sortedBreakdownData = [...metaBreakdownData].sort((a, b) => {
    const aVal = a[campaignSortConfig.field] || 0;
    const bVal = b[campaignSortConfig.field] || 0;
    return campaignSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const orderedCountryTrends = [...countryTrends].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0));

  const parseLocalDate = useCallback((dateString) => {
    if (!dateString) return null;
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? `${dateString}T00:00:00` : dateString;
    const parsed = new Date(safeDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, []);

  const formatCountryTick = useCallback((dateString) => {
    const date = parseLocalDate(dateString);
    return date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : dateString;
  }, [parseLocalDate]);

  const formatCountryTooltip = useCallback((dateString) => {
    const date = parseLocalDate(dateString);
    return date
      ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : dateString;
  }, [parseLocalDate]);

  const shopifyRegion = selectedShopifyRegion ?? 'us';
  const timeOfDayTimezone = timeOfDay?.timezone ?? (shopifyRegion === 'europe' ? 'Europe/London' : shopifyRegion === 'all' ? 'UTC' : 'America/Chicago');
  const timeOfDayData = Array.isArray(timeOfDay?.data) ? timeOfDay.data : [];
  const timeOfDaySource = timeOfDay?.source || '';
  const timeOfDayMessage = timeOfDay?.message || '';
  const hourlyChartData = timeOfDayData.map((point) => ({
    ...point,
    hourLabel: `${point.hour}:00`
  }));

  const totalHourlyOrders = timeOfDayData.reduce((sum, point) => sum + (point.orders || 0), 0);

  const handleCountrySort = (field) => {
    setCountrySortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const toggleCountryRow = (code) => {
    setExpandedCountries(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
        if (code === 'US') {
          setExpandedStates(prevStates => new Set([...prevStates].filter(key => !key.startsWith(`${code}-`))));
        }
      } else {
        next.add(code);
      }
      return next;
    });
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
      case 'age_gender':
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded font-medium">{row.age}</span>
            <span className="px-2 py-1 bg-pink-100 text-pink-700 rounded font-medium">{row.genderLabel || row.gender}</span>
          </div>
        );
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

  const metaTotals = {
    spend: dashboard.metaSpendTotal || 0,
    revenue: dashboard.metaRevenueTotal || 0,
    roas: dashboard.metaRoasTotal,
    campaigns: dashboard.metaCampaignCount || 0,
    impressions: dashboard.metaImpressionsTotal || 0,
    reach: dashboard.metaReachTotal || 0,
    clicks: dashboard.metaClicksTotal || 0,
    ctr: dashboard.metaCtrTotal,
    lpv: dashboard.metaLpvTotal || 0,
    atc: dashboard.metaAtcTotal || 0,
    checkout: dashboard.metaCheckoutTotal || 0,
    conversions: dashboard.metaConversionsTotal || 0,
    cac: dashboard.metaCacTotal
  };

  const metaOverallRow = {
    campaignName: 'All Campaigns',
    dimension: 'Overall',
    spend: metaTotals.spend,
    conversionValue: metaTotals.revenue,
    conversions: metaTotals.conversions,
    impressions: metaTotals.impressions,
    clicks: metaTotals.clicks,
    ctr: metaTotals.impressions > 0 ? (metaTotals.clicks / metaTotals.impressions) * 100 : null,
    cpc: metaTotals.clicks > 0 ? metaTotals.spend / metaTotals.clicks : null,
    metaRoas: metaTotals.roas ?? null,
    metaAov: metaTotals.conversions > 0 ? metaTotals.revenue / metaTotals.conversions : null,
    metaCac: metaTotals.conversions > 0 ? metaTotals.spend / metaTotals.conversions : null,
    cr: metaTotals.clicks > 0 ? (metaTotals.conversions / metaTotals.clicks) * 100 : null
  };

  const metaBreakdownRows =
    metaBreakdown === 'none' ? [metaOverallRow] : sortedBreakdownData;

  const metaCtrValue =
    metaTotals.ctr != null
      ? metaTotals.ctr * 100
      : (metaTotals.impressions > 0 ? (metaTotals.clicks / metaTotals.impressions) * 100 : null);

  const breakdownLabels = {
    none: 'Overall',
    country: 'Country',
    age: 'Age',
    gender: 'Gender',
    age_gender: 'Age + Gender',
    placement: 'Placement'
  };

  const renderCurrency = (value, decimals = 0) =>
    value === null || value === undefined || Number.isNaN(value)
      ? '—'
      : formatCurrency(value, decimals);

  const renderNumber = (value) =>
    value === null || value === undefined || Number.isNaN(value)
      ? '—'
      : formatNumber(value);

  const renderPercent = (value, decimals = 2) => {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(decimals)}%` : '—';
  };

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

      {/* FUNNEL DIAGNOSTICS */}
      {funnelDiagnostics && (
        <FunnelDiagnostics
          data={funnelDiagnostics}
          currency={store.currencySymbol === '$' ? 'USD' : 'SAR'}
          formatCurrency={formatCurrency}
        />
      )}

      {/* UNIFIED ANALYTICS SECTION — COUNTRIES (TRUE) & META AD MANAGER */}
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

            <div className="overflow-x-auto">
              <table>
                <thead>
                  {/* Funnel Stage Headers */}
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
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
                  {metaAdManagerData.map((campaign) => {
                    const campaignExpanded = expandedCampaigns.has(campaign.campaign_id);
                    return (
                      <Fragment key={campaign.campaign_id}>
                        {/* Campaign Row */}
                        <tr className="bg-gray-100 hover:bg-gray-200 cursor-pointer" onClick={() => {
                          const newSet = new Set(expandedCampaigns);
                          if (campaignExpanded) newSet.delete(campaign.campaign_id);
                          else newSet.add(campaign.campaign_id);
                          setExpandedCampaigns(newSet);
                        }}>
                          <td className="px-4 py-2 font-semibold">
                            <div className="flex items-center gap-2">
                              <ChevronDown className={`w-4 h-4 transform transition-transform ${campaignExpanded ? 'rotate-180' : ''}`} />
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
                                <td className="px-4 py-2 pl-12 font-medium">
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
                                  <td className="px-4 py-2 pl-20 text-sm text-gray-700">
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
                  {metaAdManagerData.length === 0 && (
                    <tr>
                      <td colSpan="20" className="px-4 py-8 text-center text-gray-500">
                        {loading ? 'Loading Meta Ad Manager data...' : 'No data available. Try syncing Meta data first.'}
                      </td>
                    </tr>
                  )}
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

      {/* Time of day trends - Now shows for both stores */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Orders by Time of Day (Last 14 Days)</h2>
            <p className="text-sm text-gray-500">
              Orders grouped by hour. Use this to spot when customers are most active.
            </p>
            {timeOfDaySource && (
              <div className="flex items-center gap-2 mt-2 text-xs text-gray-600 flex-wrap">
                <span>Data source:</span>
                <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-50 text-green-700 font-medium">
                  {timeOfDaySource}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-600 flex-wrap">
              <span>Time Zone:</span>
              <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                {timeOfDayTimezone}
              </span>
            </div>
            {store.id === 'shawq' && (
              <div className="flex items-center gap-2 mt-2 text-xs text-gray-600 flex-wrap">
                <span>Region:</span>
                <div className="flex items-center gap-1">
                  <button
                    className={`px-2 py-1 rounded ${shopifyRegion === 'all' ? 'bg-gray-200 text-gray-900' : 'bg-white text-gray-600 border'}`}
                    onClick={() => setSelectedShopifyRegion('all')}
                  >
                    All Orders
                  </button>
                  <button
                    className={`px-2 py-1 rounded ${shopifyRegion === 'us' ? 'bg-gray-200 text-gray-900' : 'bg-white text-gray-600 border'}`}
                    onClick={() => setSelectedShopifyRegion('us')}
                  >
                    US Orders
                  </button>
                  <button
                    className={`px-2 py-1 rounded ${shopifyRegion === 'europe' ? 'bg-gray-200 text-gray-900' : 'bg-white text-gray-600 border'}`}
                    onClick={() => setSelectedShopifyRegion('europe')}
                  >
                    Europe Orders
                  </button>
                </div>
              </div>
            )}
            {timeOfDay?.sampleTimestamps?.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Sample timestamps: {timeOfDay.sampleTimestamps.join(', ')}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-gray-400">Total orders</div>
            <div className="text-2xl font-bold text-gray-900">{totalHourlyOrders}</div>
          </div>
        </div>

        {hourlyChartData.length > 0 && totalHourlyOrders > 0 ? (
          <div className="h-64 mt-4">
            <ResponsiveContainer>
              <LineChart data={hourlyChartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="hourLabel" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value, name) => [value, name === 'orders' ? 'Orders' : 'Revenue']}
                  labelFormatter={(label) => `${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            {timeOfDayMessage === 'Requires Salla connection' ? (
              <div className="flex items-center justify-center gap-2 text-amber-600 py-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">Requires Salla connection</span>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {timeOfDayMessage || 'Time of Day data unavailable for this store.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Countries Performance (ecommerce-driven with cities) */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold">Countries Performance</h2>
          <p className="text-sm text-gray-500">
            Click headers to sort
          </p>
          {countriesDataSource && (
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
              <span>Data source:</span>
              <span className={`inline-flex items-center px-2 py-1 rounded-full font-medium ${
                countriesDataSource === 'Meta' ? 'bg-blue-50 text-blue-700' :
                countriesDataSource === 'Salla' ? 'bg-green-50 text-green-700' :
                'bg-purple-50 text-purple-700'
              }`}>
                {countriesDataSource}
              </span>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="text-left">Country</th>
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
                const share = totalCountrySpend > 0 ? (c.spend / totalCountrySpend) * 100 : 0;
                const isExpanded = expandedCountries.has(c.code);
                const hasCities = Array.isArray(c.cities) && c.cities.length > 0;
                const isUsCountry = c.code === 'US';
                return (
                  <Fragment key={c.code}>
                    <tr
                      className={hasCities ? 'cursor-pointer hover:bg-gray-50' : ''}
                      onClick={() => hasCities && toggleCountryRow(c.code)}
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          {hasCities && (
                            <span className="text-gray-400">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </span>
                          )}
                          <span className="text-xl">{c.flag}</span>
                          <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-gray-400">{c.code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-indigo-600 font-semibold">{formatCurrency(c.spend)}</td>
                      <td className="text-green-600 font-semibold">{formatCurrency(c.revenue || 0)}</td>
                      <td>{renderPercent(share, 0)}</td>
                      <td>
                        <span className="badge badge-green">{c.totalOrders}</span>
                      </td>
                      <td>{formatCurrency(c.aov)}</td>
                      <td className={c.cac > 80 ? 'text-amber-600 font-medium' : ''}>{formatCurrency(c.cac, 2)}</td>
                      <td className="text-green-600 font-semibold">{renderRoas(c.roas)}</td>
                    </tr>
                    {isExpanded && hasCities && (
                      <tr key={`${c.code}-cities`}>
                        <td colSpan={8} className="bg-gray-50">
                          <div className="p-4">
                            <div className="text-sm font-semibold mb-2">Cities</div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-gray-500">
                                  <th>{isUsCountry ? 'City, State' : 'City'}</th>
                                  <th>Orders</th>
                                  <th>Revenue</th>
                                  <th>AOV</th>
                                  <th>Spend</th>
                                  <th>CAC</th>
                                  <th>ROAS</th>
                                </tr>
                              </thead>
                              <tbody>
                {c.cities.some(city => city.requiresSalla)
                    ? (
                      <tr>
                        <td colSpan={7} className="text-center py-4">
                          <div className="flex items-center justify-center gap-2 text-amber-600">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm font-medium">Requires Salla connection</span>
                          </div>
                        </td>
                      </tr>
                    )
                    : [...c.cities]
                        .sort((a, b) => (b.orders || 0) - (a.orders || 0))
                        .map((city, idx) => (
                      <tr key={`${c.code}-${city.city || 'unknown'}-${idx}`}>
                        <td>
                          {isUsCountry && city.state
                            ? `${city.city || 'Unknown'}, ${city.state}`
                            : (city.city || 'Unknown')}
                        </td>
                        <td>{city.orders || 0}</td>
                        <td className="text-green-600 font-semibold">{formatCurrency(city.revenue || 0)}</td>
                        <td>{formatCurrency(city.aov || 0)}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Country order trends (collapsible) */}
      {orderedCountryTrends && orderedCountryTrends.length > 0 && (
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
              {countryTrendsDataSource && (
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                  <span>Data source:</span>
                  <span className={`inline-flex items-center px-2 py-1 rounded-full font-medium ${
                    countryTrendsDataSource === 'Meta' ? 'bg-blue-50 text-blue-700' :
                    countryTrendsDataSource === 'Salla' ? 'bg-green-50 text-green-700' :
                    'bg-purple-50 text-purple-700'
                  }`}>
                    {countryTrendsDataSource}
                  </span>
                </div>
              )}
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
              {orderedCountryTrends.map((country) => (
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
                          tickFormatter={formatCountryTick}
                        />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip
                          labelFormatter={formatCountryTooltip}
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
            </div>
          )}
        </div>
      )}

      {/* Orders by Day of Week (Fix 8) */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-6">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-lg font-semibold">Orders by Day of Week</h2>
              <p className="text-sm text-gray-500">
                Which days get the most orders? Use this to plan your marketing.
              </p>
              {daysOfWeek.source && (
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                  <span>Data source:</span>
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-50 text-green-700 font-medium">
                    {daysOfWeek.source}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Period:</span>
              <button
                className={`px-3 py-1.5 text-xs rounded-lg font-medium ${daysOfWeekPeriod === '14d' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                onClick={() => setDaysOfWeekPeriod('14d')}
              >
                14D
              </button>
              <button
                className={`px-3 py-1.5 text-xs rounded-lg font-medium ${daysOfWeekPeriod === '30d' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                onClick={() => setDaysOfWeekPeriod('30d')}
              >
                30D
              </button>
              <button
                className={`px-3 py-1.5 text-xs rounded-lg font-medium ${daysOfWeekPeriod === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                onClick={() => setDaysOfWeekPeriod('all')}
              >
                All Time
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="text-left">Rank</th>
                <th className="text-left">Day</th>
                <th className="text-right">Orders</th>
                <th className="text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {daysOfWeek.data && daysOfWeek.data.map((day) => (
                <tr key={day.day}>
                  <td>
                    <div className="flex items-center gap-2">
                      {day.rank === 1 && <span>🥇</span>}
                      {day.rank === 2 && <span>🥈</span>}
                      {day.rank === 3 && <span>🥉</span>}
                      <span className="text-gray-500">#{day.rank}</span>
                    </div>
                  </td>
                  <td className="font-medium">{day.day}</td>
                  <td className="text-right">
                    <span className="badge badge-green">{day.orders}</span>
                  </td>
                  <td className="text-right text-gray-600">{day.percentage}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td colSpan={2}>Total</td>
                <td className="text-right">{daysOfWeek.totalOrders}</td>
                <td className="text-right">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

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
  
  // Use the pre-calculated change from backend (works correctly for Today/Yesterday)
  const change = kpi.change || 0;
  const isPositive = change >= 0;
  const isGoodChange = (kpi.key === 'cac' || kpi.key === 'spend')
    ? change < 0
    : change > 0;
  
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
        {change !== 0 && (
          <span className={`flex items-center gap-1 text-xs font-medium ${isGoodChange ? 'text-green-600' : 'text-red-500'}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(change).toFixed(1)}%
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

function BudgetIntelligenceTab({ data, formatCurrency, store }) {
  const [selectedCountry, setSelectedCountry] = useState('');
  const [objective, setObjective] = useState('purchases');
  const [brandSelection, setBrandSelection] = useState(store.id);

  const countryCodeToFlag = useCallback((code) => {
    if (!code || !/^[A-Z]{2}$/.test(code)) return '🏳️';
    return String.fromCodePoint(...code.split('').map(char => 127397 + char.charCodeAt(0)));
  }, []);

  const countriesWithData = useMemo(
    () => new Set((data?.availableCountries || []).map(c => c.code)),
    [data]
  );

  const masterCountries = useMemo(() => {
    return MASTER_COUNTRIES.map(country => {
      const dataCountry = data?.availableCountries?.find(c => c.code === country.code);
      return {
        ...country,
        flag: dataCountry?.flag || countryCodeToFlag(country.code)
      };
    });
  }, [countryCodeToFlag, data]);

  const countryOptions = useMemo(() => {
    const apiCountries = Array.isArray(data?.availableCountries) ? data.availableCountries : [];
    if (apiCountries.length > 0) return apiCountries;
    return masterCountries;
  }, [data?.availableCountries, masterCountries]);

  useEffect(() => {
    if (!selectedCountry) {
      if (countryOptions.length) {
        setSelectedCountry(countryOptions[0].code);
      }
    }
    setBrandSelection(store.id);
  }, [store.id, selectedCountry, countryOptions]);

  const planningDefaults = data?.planningDefaults || {};
  const priors = data?.priors || {};

  const hasSelectedCountryData = countriesWithData.has(selectedCountry);

  const buildPlanFromPriors = (countryCode) => {
    const targetRange = planningDefaults.targetPurchasesRange || { min: 8, max: 15 };
    const targetPurchases = (targetRange.min + targetRange.max) / 2;
    const testDays = planningDefaults.testDays || 4;
    const baseCac = priors.meanCAC || priors.targetCAC || 1;
    let daily = (baseCac * targetPurchases) / testDays;

    const comparables = planningDefaults.comparableDailySpends || [];
    if (comparables.length > 0) {
      let nearest = comparables[0];
      let minDiff = Math.abs(daily - nearest);
      for (const val of comparables) {
        const diff = Math.abs(daily - val);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = val;
        }
      }
      daily = Math.max(nearest * 0.7, Math.min(nearest * 1.3, daily));
    }

    if (planningDefaults.minDaily) {
      daily = Math.max(daily, planningDefaults.minDaily);
    }
    if (planningDefaults.maxDaily) {
      daily = Math.min(daily, planningDefaults.maxDaily);
    }

    const expectedPurchases = (daily * testDays) / Math.max(baseCac, 1);

    return {
      country: countryCode,
      name: countryCode,
      flag: '🏳️',
      recommendedDaily: daily,
      recommendedTotal: daily * testDays,
      testDays,
      posteriorCAC: baseCac,
      posteriorROAS: priors.meanROAS || priors.targetROAS || 0,
      expectedPurchases,
      expectedRange: {
        low: Math.max(targetRange.min * 0.8, expectedPurchases * 0.8),
        high: Math.min(targetRange.max * 1.2, expectedPurchases * 1.2)
      },
      confidence: 'Low',
      confidenceBand: {
        low: (priors.meanROAS || 0) * 0.8,
        high: (priors.meanROAS || 0) * 1.2
      },
      rationale: 'Brand priors applied because no geo history',
      effectiveN: 1
    };
  };

  const startPlan = useMemo(() => {
    if (!data) return null;
    const fromServer = data.startPlans?.find(p => p.country === selectedCountry);
    if (fromServer) return fromServer;
    if (selectedCountry) return buildPlanFromPriors(selectedCountry);
    return data.startPlans?.[0] || null;
  }, [data, selectedCountry]);

  const formatMetric = (value, decimals = 2) =>
    value === null || value === undefined || Number.isNaN(value)
      ? '—'
      : Number(value).toFixed(decimals);

  const formatCurrencySafe = (value, decimals = 0) =>
    value === null || value === undefined || Number.isNaN(value)
      ? '—'
      : formatCurrency(value, decimals);

  const guidance = data?.liveGuidance || [];
  const learningMap = data?.learningMap || {};

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Start Budget Planner (New Geo)</h2>
            <p className="text-sm text-gray-600">Disciplined starting budgets grounded in brand priors and nearby performance.</p>
          </div>
          <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            Prior window: {data?.priorRange?.startDate || '—'} to {data?.priorRange?.endDate || '—'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Country</label>
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="mt-2 w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {countryOptions.map(c => (
                <option key={c.code} value={c.code}>
                  {`${c.flag || countryCodeToFlag(c.code)} ${c.name} (${c.code})`}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span
                className={`px-2 py-0.5 rounded-full font-semibold ${
                  hasSelectedCountryData ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {hasSelectedCountryData ? 'data' : 'new'}
              </span>
              {!hasSelectedCountryData && (
                <span className="text-amber-700">No historical data yet — using global baseline.</span>
              )}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Brand</label>
            <select
              value={brandSelection}
              onChange={(e) => setBrandSelection(e.target.value)}
              className="mt-2 w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700"
              disabled
            >
              <option value="vironax">VironaX</option>
              <option value="shawq">Shawq</option>
            </select>
            <p className="text-[11px] text-gray-500 mt-1">Use the store switcher above to change brand.</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Objective</label>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="mt-2 w-full px-4 py-2 border border-gray-200 rounded-lg"
            >
              <option value="purchases">Purchases (default)</option>
              <option value="atc">Add To Cart (fallback)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
            <p className="text-sm text-gray-500">Recommended starting daily</p>
            <div className="text-3xl font-bold text-gray-900 mt-1">
              {startPlan ? formatCurrencySafe(startPlan.recommendedDaily, 0) : '—'}
            </div>
            <p className="text-xs text-gray-500 mt-1">Test for {startPlan?.testDays || planningDefaults.testDays || 4} days • Objective: {objective === 'atc' ? 'ATC' : 'Purchases'}</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
            <p className="text-sm text-gray-500">Expected purchases (range)</p>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {startPlan ? `${formatMetric(startPlan.expectedRange.low, 1)} - ${formatMetric(startPlan.expectedRange.high, 1)}` : '—'}
            </div>
            <p className="text-xs text-gray-500 mt-1">Posterior CAC {formatCurrencySafe(startPlan?.posteriorCAC || priors.meanCAC, 0)} | ROAS {formatMetric(startPlan?.posteriorROAS || priors.meanROAS, 2)}</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
            <p className="text-sm text-gray-500">Confidence band</p>
            <div className="text-xl font-semibold text-gray-900 mt-1">
              {startPlan ? `${formatMetric(startPlan.confidenceBand.low, 2)} - ${formatMetric(startPlan.confidenceBand.high, 2)}` : '—'}
            </div>
            <p className="text-xs text-gray-500 mt-1">Signal strength: {startPlan?.confidence || 'Low'} • {startPlan?.rationale || 'Using priors'}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Live Scale/Hold/Cut Guidance</h2>
            <p className="text-sm text-gray-600">Posterior performance with uncertainty-aware probabilities.</p>
          </div>
          <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            Targets — ROAS ≥ {priors.targetROAS || '—'} | CAC ≤ {formatCurrencySafe(priors.targetCAC, 0)}
          </div>
        </div>

        {guidance.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No Meta campaigns found for this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="py-3 px-4 text-left">Campaign × Country</th>
                  <th className="py-3 px-4 text-right">Spend</th>
                  <th className="py-3 px-4 text-right">Purchases</th>
                  <th className="py-3 px-4 text-right">Revenue</th>
                  <th className="py-3 px-4 text-right">AOV</th>
                  <th className="py-3 px-4 text-right">CAC</th>
                  <th className="py-3 px-4 text-right">ROAS</th>
                  <th className="py-3 px-4 text-right">Posterior CAC</th>
                  <th className="py-3 px-4 text-right">Posterior ROAS</th>
                  <th className="py-3 px-4 text-left">Action</th>
                  <th className="py-3 px-4 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {guidance.map((row) => {
                  const badgeStyles = row.action === 'Scale'
                    ? 'bg-green-100 text-green-700'
                    : row.action === 'Cut'
                      ? 'bg-red-100 text-red-700'
                      : row.action === 'Insufficient Data'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-700';
                  return (
                    <tr key={`${row.campaignId}-${row.country}`} className="border-t border-gray-100">
                      <td className="py-3 px-4">
                        <div className="font-medium text-gray-900">{row.campaignName || 'Unnamed Campaign'}</div>
                        <div className="text-xs text-gray-500">{row.country || '—'}</div>
                      </td>
                      <td className="py-3 px-4 text-right">{formatCurrency(row.spend, 0)}</td>
                      <td className="py-3 px-4 text-right">{formatMetric(row.purchases, 0)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrencySafe(row.revenue, 0)}</td>
                      <td className="py-3 px-4 text-right">{formatMetric(row.aov, 0)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrencySafe(row.cac, 0)}</td>
                      <td className="py-3 px-4 text-right">{formatMetric(row.roas, 2)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrencySafe(row.posteriorCAC, 0)}</td>
                      <td className="py-3 px-4 text-right">{formatMetric(row.posteriorROAS, 2)}</td>
                      <td className="py-3 px-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${badgeStyles}`}>
                          {row.action}
                        </span>
                        {row.action === 'Scale' && <div className="text-[11px] text-gray-500">Suggest +15% to +25% daily</div>}
                        {row.action === 'Cut' && <div className="text-[11px] text-gray-500">Suggest -20% to -35% daily</div>}
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-sm max-w-xs">{row.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-3">These are probabilistic recommendations using smoothed performance to avoid overreacting to noise.</p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Learning Health &amp; Expansion Map</h2>
            <p className="text-sm text-gray-600">Ranked by smoothed ROAS minus CAC with signal strength bonus.</p>
          </div>
          <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Signal bonus grows with purchases/orders</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <LearningColumn title="High priority to test" data={learningMap.highPriority} accent="border-green-500" />
          <LearningColumn title="Promising but noisy" data={learningMap.noisy} accent="border-amber-500" />
          <LearningColumn title="Likely poor fit" data={learningMap.poorFit} accent="border-red-500" />
          <LearningColumn title="Not enough signal" data={learningMap.lowSignal} accent="border-gray-300" />
        </div>
      </div>
    </div>
  );
}

function LearningColumn({ title, data, accent }) {
  return (
    <div className={`border rounded-xl p-4 ${accent} bg-gray-50`}>
      <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
      {(!data || data.length === 0) && (
        <p className="text-sm text-gray-500">—</p>
      )}
      <div className="space-y-3">
        {(data || []).map((item) => (
          <div key={item.country} className="bg-white rounded-lg p-3 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>{item.flag}</span>
                <div>
                  <div className="font-medium text-gray-900 text-sm">{item.name || item.country}</div>
                  <div className="text-xs text-gray-500">Posterior ROAS {item.posteriorROAS ? item.posteriorROAS.toFixed(2) : '—'} | CAC {item.posteriorCAC ? Math.round(item.posteriorCAC) : '—'}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500">N={item.effectiveN}</div>
            </div>
          </div>
        ))}
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
  manualSpendOverrides,
  spendOverrideForm,
  setSpendOverrideForm,
  onAddSpendOverride,
  onDeleteSpendOverride,
  onBulkDelete,
  formatCurrency,
  store,
  availableCountries
}) {
  const [deleteScope, setDeleteScope] = useState('day');
  const [deleteDate, setDeleteDate] = useState(getLocalDateString());

  // --- CSV Import State & Logic ---
  const [metaImportLoading, setMetaImportLoading] = useState(false);
  const [metaImportError, setMetaImportError] = useState('');
  const [metaImportResult, setMetaImportResult] = useState(null);
  const [metaCsvText, setMetaCsvText] = useState('');

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function parseCsvToRows(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] !== undefined ? cols[idx].replace(/^"|"$/g, '') : '';
      });
      rows.push(obj);
    }
    return rows;
  }

  async function handleMetaCsvFile(file) {
    setMetaImportError('');
    setMetaImportResult(null);
    if (!file) return;
    const text = await file.text();
    setMetaCsvText(text);
  }

  async function submitMetaImport() {
    try {
      setMetaImportLoading(true);
      setMetaImportError('');
      setMetaImportResult(null);

      const rows = parseCsvToRows(metaCsvText);
      if (!rows.length) {
        setMetaImportError('CSV looks empty or unreadable. Export a daily Meta report as CSV and try again.');
        return;
      }

      const res = await fetch(`/api/analytics/meta/import?store=${store.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: store.id, rows })
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Meta import failed');
      }

      setMetaImportResult(json);
    } catch (e) {
      setMetaImportError(e?.message || 'Meta import failed');
    } finally {
      setMetaImportLoading(false);
    }
  }

  const overrideLabel = (code) => {
    if (code === 'ALL') return 'All Countries (override total spend)';
    const country = availableCountries.find(c => c.code === code);
    return country ? `${country.flag} ${country.name}` : code;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* 1. Manual Order Form */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Manual Order
        </h3>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-7 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <select
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              >
                {availableCountries.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
              <input
                type="text"
                value={form.campaign}
                onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                placeholder="Campaign name"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"># Orders</label>
              <input
                type="number"
                min="1"
                value={form.orders_count}
                onChange={(e) => setForm({ ...form, orders_count: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revenue ({store.currencySymbol})</label>
              <input
                type="number"
                min="0"
                value={form.revenue}
                onChange={(e) => setForm({ ...form, revenue: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Spend ({store.currencySymbol})</label>
              <input
                type="number"
                min="0"
                value={form.spend}
                onChange={(e) => setForm({ ...form, spend: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
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

      {/* 2. Meta CSV Import (NEW SECTION) */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2">Temporary Meta Import (CSV)</h3>
        <p className="text-sm text-gray-500 mb-4">
          Export a daily report from Meta Ads Manager as CSV (campaign + country or breakdowns),
          then upload it here. We will ingest it into the dashboard as a temporary replacement
          until the token sync is fixed.
        </p>

        <div className="flex flex-col gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleMetaCsvFile(e.target.files?.[0])}
            className="text-sm"
          />

          <textarea
            className="w-full border rounded-lg p-3 text-xs font-mono min-h-[120px]"
            placeholder="Optional: paste CSV content here"
            value={metaCsvText}
            onChange={(e) => setMetaCsvText(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={submitMetaImport}
              disabled={metaImportLoading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {metaImportLoading ? 'Importing…' : 'Import Meta CSV'}
            </button>

            <button
              onClick={async () => {
                if(!confirm('Are you sure? This deletes ALL Meta data for this store. Use this if your data looks inflated or wrong.')) return;
                try {
                  const res = await fetch(`/api/analytics/meta/clear?store=${store.id}`, { method: 'DELETE' });
                  const json = await res.json();
                  if(json.success) {
                    alert('Data cleared! You can now re-upload your clean CSV.');
                    window.location.reload();
                  } else {
                    alert('Error: ' + (json.error || 'Failed to clear'));
                  }
                } catch(e) {
                  alert('Error: ' + e.message);
                }
              }}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200"
            >
              Reset Data
            </button>
            {metaImportError && (
              <span className="text-sm text-red-600">{metaImportError}</span>
            )}
            {metaImportResult && (
              <span className="text-sm text-green-700">
                Imported: {metaImportResult.inserted} • Updated: {metaImportResult.updated} • Skipped: {metaImportResult.skipped}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Manual Spend Overrides */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Manual Spend Overrides
        </h3>
        <form onSubmit={onAddSpendOverride} className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={spendOverrideForm.date}
                onChange={(e) => setSpendOverrideForm({ ...spendOverrideForm, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
              <select
                value={spendOverrideForm.country}
                onChange={(e) => setSpendOverrideForm({ ...spendOverrideForm, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              >
                <option value="ALL">All Countries (override total)</option>
                {availableCountries.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Spend ({store.currencySymbol})</label>
              <input
                type="number"
                min="0"
                value={spendOverrideForm.amount}
                onChange={(e) => setSpendOverrideForm({ ...spendOverrideForm, amount: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={spendOverrideForm.notes}
                onChange={(e) => setSpendOverrideForm({ ...spendOverrideForm, notes: e.target.value })}
                placeholder="Reason or details"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              />
            </div>
          </div>
          <button
            type="submit"
            className="px-6 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Save Manual Spend
          </button>
        </form>

        <div className="mt-6 space-y-3">
          {manualSpendOverrides.length === 0 ? (
            <div className="text-gray-500 text-sm">No manual spend overrides added for this period.</div>
          ) : (
            manualSpendOverrides.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="space-y-1">
                  <div className="font-medium text-gray-900">{overrideLabel(entry.country)}</div>
                  <div className="text-sm text-gray-600">{entry.date}</div>
                  <div className="text-sm text-indigo-700 font-semibold">{formatCurrency(entry.amount || 0)}</div>
                  {entry.notes && <div className="text-sm text-gray-500">{entry.notes}</div>}
                </div>
                <button
                  onClick={() => onDeleteSpendOverride(entry.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 4. Orders History */}
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
              <div key={order.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 border-indigo-500">
                <div className="flex items-center gap-6">
                  <span className="font-medium">{order.date}</span>
                  <span className="px-2 py-1 bg-gray-200 rounded text-sm">{order.country}</span>
                  <span className="px-2 py-1 bg-gray-200 rounded text-sm capitalize">{order.source}</span>
                  <span>
                    <strong>{order.orders_count}</strong> orders •{' '}
                    <span className="text-green-600 font-medium">{formatCurrency(order.revenue)}</span>
                    {order.spend ? <span className="ml-2 text-indigo-600 font-medium">Spend: {formatCurrency(order.spend)}</span> : null}
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

      {/* 5. Delete Manual Data */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-red-700 mb-4 flex items-center gap-2">
          <Trash2 className="w-5 h-5" />
          Delete Manual Data
        </h3>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Delete data for</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
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

// ============================================================================
// FUNNEL DIAGNOSTICS COMPONENT
// ============================================================================

// Benchmark constants (inline for frontend)
const JEWELRY_BENCHMARKS = {
  ctr: { poor: 1.0, average: 1.5, good: 2.5 },
  cpc: { poor: 5, average: 3, good: 1.5 },
  cpm: { poor: 60, average: 40, good: 20 },
  frequency: { poor: 3.0, average: 2.0, good: 1.3 },
  lpvRate: { poor: 50, average: 70, good: 85 },
  atcRate: { poor: 2, average: 4, good: 7 },
  checkoutRate: { poor: 25, average: 40, good: 55 },
  purchaseRate: { poor: 30, average: 50, good: 70 },
  cvr: { poor: 0.5, average: 1.0, good: 2.0 },
  roas: { poor: 1.5, average: 2.5, good: 4.0 },
  cacPercent: { poor: 50, average: 30, good: 15 },
};

const ALERT_THRESHOLDS = {
  ctr: { drop: 20, spike: 30 },
  cvr: { drop: 25, spike: 35 },
  roas: { drop: 25, spike: 40 },
  cpc: { increase: 30, decrease: 25 },
  cpm: { increase: 35, decrease: 30 },
  atcRate: { drop: 20, spike: 30 },
  purchaseRate: { drop: 25, spike: 35 },
  cac: { increase: 30, decrease: 25 },
  checkoutRate: { drop: 20, spike: 30 },
  lpvRate: { drop: 20, spike: 25 },
};

const DIAGNOSTIC_RECOMMENDATIONS = {
  ctr: {
    poor: "Creative fatigue or wrong audience. Test new ad creatives with different hooks, try video content, or refine audience targeting. Check if ad frequency is too high.",
    average: "Creative is performing at industry average. A/B test new headlines, images, or CTAs to push into good territory."
  },
  cpc: {
    poor: "Paying too much per click. Review audience targeting - may be too narrow or competitive. Try broader audiences or lookalikes. Check if bidding strategy is optimal.",
    average: "CPC is acceptable but has room for improvement. Test different placements or times of day."
  },
  cpm: {
    poor: "High competition for your audience. Try different audience segments, adjust geographic targeting, or test different ad placements (Reels, Stories often cheaper).",
    average: "CPM is within normal range. Monitor for seasonal spikes."
  },
  frequency: {
    poor: "Ad fatigue detected - same people seeing your ad too many times. Refresh creatives immediately, expand audience size, or exclude recent converters.",
    average: "Approaching fatigue zone. Plan new creatives within 1-2 weeks."
  },
  lpvRate: {
    poor: "People click but don't reach landing page. Check: 1) Page load speed (should be <3s), 2) Mobile responsiveness, 3) Broken redirects, 4) Accidental clicks from ad placement.",
    average: "Some drop-off between click and landing page. Optimize page speed and ensure mobile experience is smooth."
  },
  atcRate: {
    poor: "Visitors view products but don't add to cart. Review: 1) Product images quality and angles, 2) Price perception vs competitors, 3) Missing trust signals (reviews, guarantees), 4) Unclear product details or sizing, 5) No urgency or scarcity messaging.",
    average: "ATC is at jewelry industry average. Test adding social proof, urgency timers, or better product photography."
  },
  checkoutRate: {
    poor: "Customers add to cart but don't start checkout. Check: 1) Surprise shipping costs, 2) Required account creation, 3) Cart page UX issues, 4) Missing payment options, 5) No guest checkout. Consider cart abandonment emails.",
    average: "Checkout initiation is acceptable. Test showing shipping costs earlier or adding trust badges to cart."
  },
  purchaseRate: {
    poor: "Customers start checkout but don't complete. Simplify checkout: 1) Reduce form fields, 2) Add progress indicator, 3) Show security badges, 4) Offer multiple payment methods, 5) Fix mobile checkout issues, 6) Add live chat support.",
    average: "Purchase completion is average. Consider adding buy-now-pay-later options or express checkout."
  },
  cvr: {
    poor: "Overall conversion is below jewelry benchmarks. Identify the biggest funnel drop-off (LPV->ATC->Checkout->Purchase) and fix that first. Consider if traffic quality is the issue.",
    average: "Conversion rate is normal for jewelry (high-consideration purchase). Focus on retargeting warm audiences and email flows."
  },
  roas: {
    poor: "Campaign is not profitable. Options: 1) Pause and optimize before spending more, 2) Reduce budget significantly, 3) Focus only on best-performing audiences/countries, 4) Check if product margins can support paid ads at current CAC.",
    average: "Campaign is marginally profitable. Optimize creatives and targeting to improve margins before scaling."
  },
  cac: {
    poor: "Customer acquisition cost is too high relative to order value. Either increase AOV (bundles, upsells) or reduce ad costs. May need to focus on higher-margin products only.",
    average: "CAC is acceptable but watch margins closely. Look for opportunities to increase AOV."
  }
};

const ALERT_RECOMMENDATIONS = {
  ctr_drop: "CTR dropped significantly. Check: 1) Creative fatigue, 2) Audience saturation, 3) Competitor activity. Refresh creatives or test new audiences.",
  ctr_spike: "CTR improved significantly! Identify what changed and apply learnings to other campaigns. Consider increasing budget.",
  cvr_drop: "Conversion rate dropped significantly. Check: 1) Website issues, 2) Landing page changes, 3) Inventory problems. Review recent changes.",
  cvr_spike: "Conversion rate improved significantly! Analyze what drove the improvement. Good time to scale.",
  roas_drop: "ROAS dropped significantly. Pause or reduce budget until fixed. Check CPM/CPC increases and CVR drops.",
  roas_spike: "ROAS improved significantly! Consider increasing budget 20-30% and testing similar audiences.",
  cpc_increase: "CPC increased significantly. Test broader audiences or new placements to reduce competition.",
  cpc_decrease: "CPC decreased! Good efficiency improvement. Monitor conversion rates.",
  cpm_increase: "CPM increased significantly. Try new placements or adjust audience targeting.",
  cpm_decrease: "CPM decreased! Good time to scale impressions if performance holds.",
  atcRate_drop: "Add-to-cart rate dropped. Check product page changes, pricing, and stock availability.",
  atcRate_spike: "Add-to-cart rate improved! Apply successful elements to other products.",
  purchaseRate_drop: "Purchase completion dropped. Check checkout flow immediately for payment or form issues.",
  purchaseRate_spike: "Purchase completion improved! Checkout optimizations working.",
  cac_increase: "CAC increased. Review ad costs and conversion rates. Pause scaling until efficient.",
  cac_decrease: "CAC improved! Good indicator to scale if sustained.",
  checkoutRate_drop: "Checkout rate dropped. Check cart page UX and shipping cost visibility.",
  checkoutRate_spike: "Checkout rate improved! Cart experience is working well.",
  lpvRate_drop: "Landing page view rate dropped. Check page speed and ad targeting quality.",
  lpvRate_spike: "Landing page view rate improved! Good traffic quality and page performance."
};

function FunnelDiagnostics({ data, currency = 'SAR', formatCurrency }) {
  if (!data || !data.current) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Funnel Diagnostics</h2>
        <p className="text-gray-500">Insufficient data for diagnostics. Need at least 7 days of data.</p>
      </div>
    );
  }

  const { current, previous, changes, sparklineData } = data;

  // Determine tier for a metric
  const getTier = (value, benchmark, lowerIsBetter = false) => {
    if (value == null || isNaN(value)) return 'unknown';
    if (lowerIsBetter) {
      if (value <= benchmark.good) return 'excellent';
      if (value <= benchmark.average) return 'good';
      if (value <= benchmark.poor) return 'average';
      return 'poor';
    } else {
      if (value >= benchmark.good) return 'excellent';
      if (value >= benchmark.average) return 'good';
      if (value >= benchmark.poor) return 'average';
      return 'poor';
    }
  };

  // Generate alerts based on changes
  const generateAlerts = () => {
    const alerts = [];

    const checkAlert = (metric, change, thresholds, lowerIsBetter = false) => {
      if (change == null) return;

      if (lowerIsBetter) {
        // For metrics where lower is better (CPC, CPM, CAC)
        if (change > thresholds.increase) {
          alerts.push({ type: 'drop', metric, change, recommendation: ALERT_RECOMMENDATIONS[`${metric}_increase`] });
        } else if (change < -thresholds.decrease) {
          alerts.push({ type: 'spike', metric, change: Math.abs(change), recommendation: ALERT_RECOMMENDATIONS[`${metric}_decrease`] });
        }
      } else {
        // For metrics where higher is better
        if (change < -thresholds.drop) {
          alerts.push({ type: 'drop', metric, change: Math.abs(change), recommendation: ALERT_RECOMMENDATIONS[`${metric}_drop`] });
        } else if (change > thresholds.spike) {
          alerts.push({ type: 'spike', metric, change, recommendation: ALERT_RECOMMENDATIONS[`${metric}_spike`] });
        }
      }
    };

    checkAlert('ctr', changes.ctr, ALERT_THRESHOLDS.ctr);
    checkAlert('cvr', changes.cvr, ALERT_THRESHOLDS.cvr);
    checkAlert('roas', changes.roas, ALERT_THRESHOLDS.roas);
    checkAlert('cpc', changes.cpc, ALERT_THRESHOLDS.cpc, true);
    checkAlert('cpm', changes.cpm, ALERT_THRESHOLDS.cpm, true);
    checkAlert('atcRate', changes.atcRate, ALERT_THRESHOLDS.atcRate);
    checkAlert('purchaseRate', changes.purchaseRate, ALERT_THRESHOLDS.purchaseRate);
    checkAlert('cac', changes.cac, ALERT_THRESHOLDS.cac, true);
    checkAlert('checkoutRate', changes.checkoutRate, ALERT_THRESHOLDS.checkoutRate);
    checkAlert('lpvRate', changes.lpvRate, ALERT_THRESHOLDS.lpvRate);

    return alerts;
  };

  const alerts = generateAlerts();

  const tierConfig = {
    excellent: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', label: 'Excellent' },
    good: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', label: 'Good' },
    average: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', label: 'Average' },
    poor: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'Poor' },
    unknown: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-500', label: 'No Data' }
  };

  // Mini sparkline component
  const Sparkline = ({ data: sparkData, metricKey, inverted = false }) => {
    if (!sparkData || sparkData.length < 2) return null;
    const values = sparkData.map(d => d?.[metricKey] || 0).filter(v => !isNaN(v));
    if (values.length < 2) return null;

    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * 60;
      const y = 20 - ((v - min) / range) * 16;
      return `${x},${y}`;
    }).join(' ');

    const trend = values[values.length - 1] - values[0];
    const color = inverted
      ? (trend > 0 ? '#ef4444' : '#22c55e')
      : (trend > 0 ? '#22c55e' : '#ef4444');

    return (
      <svg width="60" height="24" className="inline-block ml-2">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          points={points}
        />
      </svg>
    );
  };

  const formatValue = (value, format) => {
    if (value == null || isNaN(value)) return '-';
    if (format === 'percent') return `${value.toFixed(2)}%`;
    if (format === 'currency') return `${value.toFixed(2)} ${currency}`;
    if (format === 'roas') return `${value.toFixed(2)}x`;
    if (format === 'number') return value.toFixed(2);
    return value;
  };

  const formatChange = (change) => {
    if (change == null || isNaN(change)) return '';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}%`;
  };

  // Metric card component
  const MetricCard = ({ name, metricKey, value, benchmark, benchmarkText, format, change, lowerIsBetter = false, recommendation }) => {
    const tier = getTier(value, benchmark, lowerIsBetter);
    const config = tierConfig[tier];
    const changeColor = lowerIsBetter
      ? (change > 0 ? 'text-red-500' : 'text-green-500')
      : (change > 0 ? 'text-green-500' : 'text-red-500');

    return (
      <div className={`p-4 rounded-lg border ${config.bg} ${config.border}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-gray-800 text-sm">{name}</span>
          <div className="flex items-center">
            <span className={`text-lg font-bold ${config.text}`}>{formatValue(value, format)}</span>
            <Sparkline data={sparklineData} metricKey={metricKey} inverted={lowerIsBetter} />
          </div>
        </div>
        {change != null && !isNaN(change) && (
          <div className={`text-xs ${changeColor} mb-2`}>
            {formatChange(change)} vs previous period
          </div>
        )}
        <div className="text-xs text-gray-500 mb-1">
          Benchmark: {benchmarkText}
        </div>
        <div className={`text-xs font-medium ${config.text}`}>
          Status: {config.label}
        </div>
        {tier === 'poor' && recommendation && (
          <div className="mt-3 p-2 bg-white bg-opacity-70 rounded text-xs text-gray-600">
            <span className="font-semibold">Tip:</span> {recommendation}
          </div>
        )}
      </div>
    );
  };

  // Calculate CAC as % of AOV
  const cacPercent = current.aov > 0 ? (current.cac / current.aov) * 100 : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Funnel Diagnostics</h2>
        <span className="text-xs text-gray-400">Benchmarks: Jewelry Industry 2024-25</span>
      </div>

      {/* Alert Banners */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg border ${
                alert.type === 'drop'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-green-50 border-green-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg">{alert.type === 'drop' ? '!' : '+'}</span>
                <div>
                  <div className={`font-semibold ${alert.type === 'drop' ? 'text-red-700' : 'text-green-700'}`}>
                    {alert.type === 'drop' ? 'ALERT' : 'WIN'}: {alert.metric.toUpperCase()} {alert.type === 'drop' ? 'dropped' : 'improved'} {alert.change.toFixed(0)}%
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {alert.recommendation}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upper Funnel */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
          Upper Funnel (Awareness)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            name="CTR"
            metricKey="ctr"
            value={current.ctr}
            benchmark={JEWELRY_BENCHMARKS.ctr}
            benchmarkText={`<1% Poor | 1-1.5% Avg | 1.5-2.5% Good | >2.5% Excellent`}
            format="percent"
            change={changes.ctr}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.ctr.poor}
          />
          <MetricCard
            name="CPC"
            metricKey="cpc"
            value={current.cpc}
            benchmark={JEWELRY_BENCHMARKS.cpc}
            benchmarkText={`>5 ${currency} Poor | 3-5 Avg | 1.5-3 Good | <1.5 Excellent`}
            format="currency"
            change={changes.cpc}
            lowerIsBetter={true}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.cpc.poor}
          />
          <MetricCard
            name="CPM"
            metricKey="cpm"
            value={current.cpm}
            benchmark={JEWELRY_BENCHMARKS.cpm}
            benchmarkText={`>60 ${currency} Poor | 40-60 Avg | 20-40 Good | <20 Excellent`}
            format="currency"
            change={changes.cpm}
            lowerIsBetter={true}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.cpm.poor}
          />
          <MetricCard
            name="Frequency"
            metricKey="frequency"
            value={current.frequency}
            benchmark={JEWELRY_BENCHMARKS.frequency}
            benchmarkText=">3 Poor | 2-3 Avg | 1.3-2 Good | 1-1.3 Excellent"
            format="number"
            change={changes.frequency}
            lowerIsBetter={true}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.frequency.poor}
          />
        </div>
      </div>

      {/* Mid Funnel */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-purple-600 uppercase tracking-wide mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
          Mid Funnel (Consideration)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            name="LPV Rate"
            metricKey="lpvRate"
            value={current.lpvRate}
            benchmark={JEWELRY_BENCHMARKS.lpvRate}
            benchmarkText="<50% Poor | 50-70% Avg | 70-85% Good | >85% Excellent"
            format="percent"
            change={changes.lpvRate}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.lpvRate.poor}
          />
          <MetricCard
            name="ATC Rate"
            metricKey="atcRate"
            value={current.atcRate}
            benchmark={JEWELRY_BENCHMARKS.atcRate}
            benchmarkText="<2% Poor | 2-4% Avg | 4-7% Good | >7% Excellent"
            format="percent"
            change={changes.atcRate}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.atcRate.poor}
          />
        </div>
      </div>

      {/* Lower Funnel */}
      <div>
        <h3 className="text-sm font-semibold text-green-600 uppercase tracking-wide mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          Lower Funnel (Conversion)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            name="Checkout Rate"
            metricKey="checkoutRate"
            value={current.checkoutRate}
            benchmark={JEWELRY_BENCHMARKS.checkoutRate}
            benchmarkText="<25% Poor | 25-40% Avg | 40-55% Good | >55% Excellent"
            format="percent"
            change={changes.checkoutRate}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.checkoutRate.poor}
          />
          <MetricCard
            name="Purchase Rate"
            metricKey="purchaseRate"
            value={current.purchaseRate}
            benchmark={JEWELRY_BENCHMARKS.purchaseRate}
            benchmarkText="<30% Poor | 30-50% Avg | 50-70% Good | >70% Excellent"
            format="percent"
            change={changes.purchaseRate}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.purchaseRate.poor}
          />
          <MetricCard
            name="CVR"
            metricKey="cvr"
            value={current.cvr}
            benchmark={JEWELRY_BENCHMARKS.cvr}
            benchmarkText="<0.5% Poor | 0.5-1% Avg | 1-2% Good | >2% Excellent"
            format="percent"
            change={changes.cvr}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.cvr.poor}
          />
          <MetricCard
            name="ROAS"
            metricKey="roas"
            value={current.roas}
            benchmark={JEWELRY_BENCHMARKS.roas}
            benchmarkText="<1.5x Poor | 1.5-2.5x Avg | 2.5-4x Good | >4x Excellent"
            format="roas"
            change={changes.roas}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.roas.poor}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <MetricCard
            name="CAC"
            metricKey="cac"
            value={current.cac}
            benchmark={JEWELRY_BENCHMARKS.cacPercent}
            benchmarkText={`>50% AOV Poor | 30-50% Avg | 15-30% Good | <15% Excellent (${cacPercent.toFixed(0)}% of AOV)`}
            format="currency"
            change={changes.cac}
            lowerIsBetter={true}
            recommendation={DIAGNOSTIC_RECOMMENDATIONS.cac.poor}
          />
        </div>
      </div>
    </div>
  );
}
