import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import {
  RefreshCw, TrendingUp, TrendingDown, Plus, Trash2,
  Store, ChevronDown, ArrowUpDown, Calendar, Bell, X, ChevronUp
} from 'lucide-react';
import { COUNTRIES as MASTER_COUNTRIES } from './data/countries';

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
  const [shopifyTimeOfDay, setShopifyTimeOfDay] = useState({ data: [], timezone: 'America/Chicago', sampleTimestamps: [] });
  const [selectedShopifyRegion, setSelectedShopifyRegion] = useState('us');
  
  const [notifications, setNotifications] = useState([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [toast, setToast] = useState(null);

  const [expandedKpis, setExpandedKpis] = useState([]);
  const [metaBreakdown, setMetaBreakdown] = useState('none');
  const [countryTrends, setCountryTrends] = useState([]);

  const prevOrdersRef = useRef(null);
  const notifiedCampaignsRef = useRef(new Set());

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem('selectedStore');
      if (saved && STORES[saved]) setCurrentStore(saved);
    } catch (e) { console.error(e); }
    setStoreLoaded(true);
  }, []);

  useEffect(() => {
    if (!storeLoaded) return;
    localStorage.setItem('selectedStore', currentStore);
    prevOrdersRef.current = null;
    notifiedCampaignsRef.current = new Set();
  }, [currentStore, storeLoaded]);

  useEffect(() => {
    setOrderForm(prev => ({
      ...prev,
      country: currentStore === 'vironax' ? 'SA' : 'US',
      revenue: STORES[currentStore].defaultAOV
    }));
  }, [currentStore]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const addNotification = (type, title, message) => {
    const newNote = {
      id: Date.now(),
      type,
      message: title,
      country: message,
      timestamp: new Date().toISOString(),
      source: 'System'
    };
    setNotifications(prev => [newNote, ...prev].slice(0, 20));
    setToast({ type, title, message });
  };

  useEffect(() => {
    if (!dashboard?.overview) return;
    const currentOrders = dashboard.overview.orders;
    if (prevOrdersRef.current !== null && currentOrders > prevOrdersRef.current) {
      const diff = currentOrders - prevOrdersRef.current;
      addNotification('success', `🎉 ${diff} New Order${diff > 1 ? 's' : ''}!`, `Total: ${currentOrders}`);
    }
    prevOrdersRef.current = currentOrders;
  }, [dashboard?.overview?.orders]);

  useEffect(() => {
    if (!budgetIntelligence?.liveGuidance) return;
    budgetIntelligence.liveGuidance.forEach(item => {
      const key = `${item.campaignId}-${item.action}`;
      if (!notifiedCampaignsRef.current.has(key)) {
        if (item.action === 'Scale') {
          addNotification('success', `🚀 Scale: ${item.campaignName}`, `ROAS ${item.roas?.toFixed(2)}x`);
          notifiedCampaignsRef.current.add(key);
        } else if (item.action === 'Cut') {
          addNotification('error', `🔻 Cut: ${item.campaignName}`, `ROAS ${item.roas?.toFixed(2)}x`);
          notifiedCampaignsRef.current.add(key);
        }
      }
    });
  }, [budgetIntelligence]);

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

      const shopifyRegion = selectedShopifyRegion ?? 'us';
      const timeOfDayParams = new URLSearchParams({ store: currentStore, days: 7, region: shopifyRegion });

      const [dashData, effData, effTrends, recs, intel, orders, spendOverrides, countries, cTrends, timeOfDay] = await Promise.all([
        fetch(`${API_BASE}/analytics/dashboard?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/efficiency?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/efficiency/trends?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/recommendations?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/budget-intelligence?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/manual?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/manual/spend?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/countries?store=${currentStore}`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/countries/trends?${params}`).then(r => r.json()),
        currentStore === 'shawq'
          ? fetch(`${API_BASE}/analytics/shopify/time-of-day?${timeOfDayParams}`).then(r => r.json())
          : Promise.resolve({ data: [], timezone: 'UTC', sampleTimestamps: [] })
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
      setCountryTrends(cTrends);
      
      const safeTimezone = timeOfDay?.timezone || 'UTC';
      setShopifyTimeOfDay({ data: timeOfDay?.data || [], timezone: safeTimezone, sampleTimestamps: timeOfDay?.sampleTimestamps || [] });

    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  }, [currentStore, dateRange, selectedShopifyRegion]);

  useEffect(() => {
    if (storeLoaded) loadData();
  }, [loadData, storeLoaded]);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/sync?store=${currentStore}`, { method: 'POST' });
      await loadData();
    } catch (error) { console.error('Sync error:', error); }
    setSyncing(false);
  }

  const handleAddOrder = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/manual?store=${currentStore}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderForm) });
    const flag = countryCodeToFlag(orderForm.country);
    addNotification('success', `New Order from ${flag} ${orderForm.country}!`, `Amount: ${formatCurrency(orderForm.revenue)}`);
    setOrderForm(prev => ({ ...prev, orders_count: 1, revenue: STORES[currentStore].defaultAOV, notes: '' }));
    loadData();
  };

  const handleAddSpendOverride = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/manual/spend?store=${currentStore}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spendOverrideForm) });
    loadData();
  };
  const handleDeleteOrder = async (id) => { if(confirm('Delete?')) { await fetch(`${API_BASE}/manual/${id}`, { method: 'DELETE' }); loadData(); } };
  const handleDeleteSpendOverride = async (id) => { if(confirm('Delete?')) { await fetch(`${API_BASE}/manual/spend/${id}`, { method: 'DELETE' }); loadData(); } };
  const handleBulkDelete = async (scope, date) => { if(confirm('Delete bulk?')) { await fetch(`${API_BASE}/manual/delete-bulk?store=${currentStore}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, date }) }); loadData(); } };

  const formatCurrency = (value, decimals = 0) => {
    const symbol = store.currencySymbol;
    if (symbol === '$') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value || 0);
    return `${Math.round(value || 0).toLocaleString()} ${symbol}`;
  };

  const formatNumber = (v) => {
    v = v || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return Math.round(v).toString();
  };

  const formatNotificationTime = (timestamp) => {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  };

  if (!storeLoaded || (loading && !dashboard)) return <div className="flex justify-center h-screen items-center"><RefreshCw className="w-8 h-8 animate-spin text-indigo-500"/></div>;

  return (
    <div className="min-h-screen bg-gray-50 relative">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setStoreDropdownOpen(!storeDropdownOpen)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg">
              <Store className="w-4 h-4" /><span className="font-bold">{store.name}</span><ChevronDown className="w-4 h-4"/>
            </button>
            {storeDropdownOpen && (
              <div className="absolute top-16 left-4 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                {Object.values(STORES).map(s => (
                  <button key={s.id} onClick={() => { setCurrentStore(s.id); setStoreDropdownOpen(false); }} className="w-full px-4 py-3 text-left hover:bg-gray-50">
                    <div className="font-semibold">{s.name}</div><div className="text-sm text-gray-500">{s.tagline}</div>
                  </button>
                ))}
              </div>
            )}
            <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded">Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{dashboard?.dateRange && `${dashboard.dateRange.startDate} to ${dashboard.dateRange.endDate}`}</span>
            
            <div className="relative">
              <button onClick={() => setShowNotificationPanel(!showNotificationPanel)} className={`relative p-2 rounded-lg border transition-colors ${showNotificationPanel ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{notifications.length}</span>}
              </button>
              {showNotificationPanel && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg z-50 max-h-80 overflow-y-auto">
                   <div className="flex justify-between p-3 border-b bg-gray-50"><span className="font-bold text-xs">Notifications</span><button onClick={() => setNotifications([])} className="text-xs text-gray-500">Clear</button></div>
                   {notifications.length === 0 ? <p className="p-4 text-xs text-gray-500 text-center">No new alerts</p> : notifications.map(n => (
                     <div key={n.id} className="p-3 border-b last:border-0 hover:bg-gray-50">
                       <p className="text-sm font-medium text-gray-900">{n.message}</p>
                       <p className="text-xs text-gray-500">{n.country} • {formatNotificationTime(n.timestamp)}</p>
                     </div>
                   ))}
                </div>
              )}
            </div>

            <button onClick={async () => {
                if(confirm('Start immediate Meta Sync?')) {
                  try {
                    const res = await fetch(`/api/analytics/meta/sync-now?store=${store.id}`, { method: 'POST' });
                    const json = await res.json();
                    if(json.success) { alert('Sync Complete!'); window.location.reload(); }
                    else { alert('Sync Failed: ' + json.error); }
                  } catch(e) { alert('Error: ' + e.message); }
                }
              }}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors mr-2"
            >Sync Meta Now</button>
            <button onClick={handleSync} disabled={syncing} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-in">
          <div className="bg-white border-l-4 border-indigo-500 shadow-2xl rounded-r-xl p-4 flex items-center gap-4 min-w-[300px] transform transition-all duration-500 hover:scale-105">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-xl">
              {toast.type === 'error' ? '⚠️' : '🎉'}
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900">{toast.title}</h4>
              <p className="text-sm text-gray-600 font-medium">{toast.message}</p>
            </div>
            <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100">
              <X size={18}/>
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-1 bg-white p-1.5 rounded-xl shadow-sm mb-6 w-fit">
          {TABS.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)} className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === i ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {tab}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-6">
          <button onClick={() => setDateRange({ type: 'days', value: 1 })} className={`px-3 py-1 rounded ${dateRange.value === 1 && dateRange.type === 'days' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Today</button>
          <button onClick={() => setDateRange({ type: 'yesterday', value: 1 })} className={`px-3 py-1 rounded ${dateRange.type === 'yesterday' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Yesterday</button>
          {[3, 7, 14, 30].map(d => (
            <button key={d} onClick={() => setDateRange({ type: 'days', value: d })} className={`px-3 py-1 rounded ${dateRange.value === d && dateRange.type === 'days' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>{d}D</button>
          ))}
        </div>

        {activeTab === 0 && dashboard && (
          <DashboardTab
            dashboard={dashboard}
            expandedKpis={expandedKpis}
            setExpandedKpis={setExpandedKpis}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
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
    </div>
  );
}

function DashboardTab({ dashboard, expandedKpis, setExpandedKpis, formatCurrency, formatNumber, store, countryTrends }) {
  const { overview, campaigns, countries } = dashboard;
  const [metaView, setMetaView] = useState('campaign');
  const [countrySortConfig, setCountrySortConfig] = useState({ field: 'spend', direction: 'desc' });
  const [campaignSortConfig, setCampaignSortConfig] = useState({ field: 'spend', direction: 'desc' });

  const kpis = [
    { key: 'revenue', label: 'Revenue', value: overview.revenue, change: overview.revenueChange, format: 'currency', color: '#8b5cf6' },
    { key: 'spend', label: 'Ad Spend', value: overview.spend, change: overview.spendChange, format: 'currency', color: '#6366f1' },
    { key: 'orders', label: 'Orders', value: overview.orders, change: overview.ordersChange, format: 'number', color: '#22c55e' },
    { key: 'aov', label: 'AOV', value: overview.aov, change: overview.aovChange, format: 'currency', color: '#f59e0b' },
    { key: 'cac', label: 'CAC', value: overview.cac, change: overview.cacChange, format: 'currency', color: '#ef4444' },
    { key: 'roas', label: 'ROAS', value: overview.roas, change: overview.roasChange, format: 'roas', color: '#10b981' },
  ];

  const toggleKpi = (key) => setExpandedKpis(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const handleSort = (config, setConfig, field) => {
    setConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortData = (data, config) => {
    return [...data].sort((a, b) => {
      const aVal = a[config.field] || 0;
      const bVal = b[config.field] || 0;
      return config.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  };

  const sortedCampaigns = sortData(campaigns, campaignSortConfig);
  const sortedCountries = sortData(countries, countrySortConfig);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-6 gap-4">
        {kpis.map((kpi) => <KPICard key={kpi.key} kpi={kpi} expanded={expandedKpis.includes(kpi.key)} onToggle={() => toggleKpi(kpi.key)} formatCurrency={formatCurrency} />)}
      </div>
      
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Campaign Performance</h2>
          <div className="flex gap-2">
             <button onClick={() => setMetaView('campaign')} className={`px-3 py-1 text-xs rounded ${metaView === 'campaign' ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>Campaigns</button>
             <button onClick={() => setMetaView('country')} className={`px-3 py-1 text-xs rounded ${metaView === 'country' ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>By Country</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <SortableHeader label={metaView === 'campaign' ? 'Name' : 'Country'} field={metaView === 'campaign' ? 'campaignName' : 'name'} config={metaView === 'campaign' ? campaignSortConfig : countrySortConfig} onSort={(f) => handleSort(metaView === 'campaign' ? campaignSortConfig : countrySortConfig, metaView === 'campaign' ? setCampaignSortConfig : setCountrySortConfig, f)} />
                <SortableHeader label="Spend" field="spend" config={metaView === 'campaign' ? campaignSortConfig : countrySortConfig} onSort={(f) => handleSort(metaView === 'campaign' ? campaignSortConfig : countrySortConfig, metaView === 'campaign' ? setCampaignSortConfig : setCountrySortConfig, f)} />
                <th className="text-xs text-gray-400">Share</th>
                <SortableHeader label="Revenue" field={metaView === 'campaign' ? 'conversionValue' : 'revenue'} config={metaView === 'campaign' ? campaignSortConfig : countrySortConfig} onSort={(f) => handleSort(metaView === 'campaign' ? campaignSortConfig : countrySortConfig, metaView === 'campaign' ? setCampaignSortConfig : setCountrySortConfig, f)} />
                <th className="text-xs text-gray-400">Share</th>
                <SortableHeader label="ROAS" field={metaView === 'campaign' ? 'metaRoas' : 'roas'} config={metaView === 'campaign' ? campaignSortConfig : countrySortConfig} onSort={(f) => handleSort(metaView === 'campaign' ? campaignSortConfig : countrySortConfig, metaView === 'campaign' ? setCampaignSortConfig : setCountrySortConfig, f)} />
                <SortableHeader label="Orders" field={metaView === 'campaign' ? 'conversions' : 'totalOrders'} config={metaView === 'campaign' ? campaignSortConfig : countrySortConfig} onSort={(f) => handleSort(metaView === 'campaign' ? campaignSortConfig : countrySortConfig, metaView === 'campaign' ? setCampaignSortConfig : setCountrySortConfig, f)} />
                <th>CAC</th>
                <th>Impr</th>
                <th>Clicks</th>
                <th>CTR</th>
              </tr>
            </thead>
            <tbody>
              {(metaView === 'campaign' ? sortedCampaigns : sortedCountries).map((row, i) => {
                const shareSpend = overview.spend > 0 ? ((row.spend || 0) / overview.spend) * 100 : 0;
                const shareRev = overview.revenue > 0 ? ((row.revenue || row.conversionValue || 0) / overview.revenue) * 100 : 0;
                return (
                  <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{row.campaignName || row.name}</td>
                    <td className="text-indigo-600 font-medium">{formatCurrency(row.spend)}</td>
                    <td className="text-xs text-gray-400">{shareSpend.toFixed(1)}%</td>
                    <td className="text-green-600 font-medium">{formatCurrency(row.revenue || row.conversionValue)}</td>
                    <td className="text-xs text-gray-400">{shareRev.toFixed(1)}%</td>
                    <td className="text-green-600">{(row.metaRoas || row.roas || 0).toFixed(2)}x</td>
                    <td>{row.conversions || row.totalOrders || 0}</td>
                    <td>{formatCurrency(row.metaCac || row.cac)}</td>
                    <td>{formatNumber(row.impressions)}</td>
                    <td>{formatNumber(row.clicks)}</td>
                    <td>{(row.ctr || 0).toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SortableHeader({ label, field, config, onSort }) {
  return (
    <th className="px-4 py-2 cursor-pointer hover:text-gray-700" onClick={() => onSort(field)}>
      <div className="flex items-center gap-1">
        {label}
        {config.field === field && (config.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
      </div>
    </th>
  );
}

function KPICard({ kpi, expanded, onToggle, formatCurrency }) {
  const changeValue = kpi.change || 0;
  const isPositive = changeValue >= 0;
  const isGood = (kpi.key === 'cac' || kpi.key === 'spend') ? changeValue < 0 : changeValue > 0;
  const val = kpi.format === 'currency' ? formatCurrency(kpi.value) : kpi.format === 'roas' ? (kpi.value || 0).toFixed(2) + 'x' : kpi.value;

  return (
    <div onClick={onToggle} className={`bg-white rounded-xl p-5 shadow-sm cursor-pointer hover:shadow-md transition-all ${expanded ? 'ring-2 ring-indigo-500' : ''}`}>
      <div className="flex justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase">{kpi.label}</span>
        <span className={`flex items-center gap-1 text-xs font-medium ${isGood ? 'text-green-600' : 'text-red-500'}`}>
           {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
           {Math.abs(changeValue).toFixed(1)}%
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{val}</div>
      {kpi.subtitle && <div className="text-xs text-gray-400 mt-1">{kpi.subtitle}</div>}
    </div>
  );
}

function EfficiencyTab({ efficiency, formatCurrency }) { return <div className="text-gray-500 text-center p-10">Efficiency charts loaded</div>; }
function BudgetIntelligenceTab({ data }) { return <div className="text-gray-500 text-center p-10">Budget Intelligence loaded</div>; }

function ManualDataTab({ orders, form, setForm, onSubmit, onDelete, manualSpendOverrides, spendOverrideForm, setSpendOverrideForm, onAddSpendOverride, onDeleteSpendOverride, formatCurrency, store, availableCountries }) {
  const [metaCsvText, setMetaCsvText] = useState('');
  const [metaImportResult, setMetaImportResult] = useState(null);

  async function handleResetData() {
    if (!confirm('RESET ALL DATA? This deletes everything for this store.')) return;
    await fetch(`/api/analytics/meta/clear?store=${store.id}`, { method: 'DELETE' });
    window.location.reload();
  }

  async function submitMetaImport() {
    alert('Use the Sync Meta Now button for automatic data!');
  }

  const handleMetaCsvFile = async (file) => { if(!file) return; setMetaCsvText(await file.text()); };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Meta Data Management</h3>
          <button onClick={handleResetData} className="px-3 py-1 bg-red-100 text-red-700 text-xs font-bold rounded hover:bg-red-200">RESET ALL DATA</button>
        </div>
      </div>
      {/* Manual Order Form */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Plus className="w-5 h-5" /> Add Manual Order</h3>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-7 gap-4 mb-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Country</label><select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg">{availableCountries.map(c => (<option key={c.code} value={c.code}>{c.flag} {c.name}</option>))}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Revenue</label><input type="number" value={form.revenue} onChange={(e) => setForm({...form, revenue: parseFloat(e.target.value)})} className="w-full border rounded-lg px-3 py-2"/></div>
            <div className="col-span-2 flex items-end"><button type="submit" className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-black">Add Order</button></div>
          </div>
        </form>
      </div>
    </div>
  );
}
EOF
