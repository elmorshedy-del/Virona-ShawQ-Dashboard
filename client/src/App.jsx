// client/src/App.jsx

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart
} from 'recharts';
import {
  RefreshCw, TrendingUp, TrendingDown, Plus, Trash2,
  ChevronDown, ChevronUp, ArrowUpDown, Calendar,
  Bell, X, AlertCircle, CheckCircle2, Sparkles
} from 'lucide-react';
import { COUNTRIES as MASTER_COUNTRIES } from './data/countries';
import NotificationCenter from './components/NotificationCenter';
import AIAnalytics from './components/AIAnalytics';
import AIBudget from './components/AIBudget';
import BudgetCalculator from './components/BudgetCalculator';
import UnifiedAnalytics from './components/UnifiedAnalytics';
import CreativeAnalysis from './components/CreativeAnalysis.jsx';
import FatigueDetector from './components/FatigueDetector';
import MetricsChartsTab from './components/MetricsChartsTab';
import AttributionTab from './components/AttributionTab';
import InsightsTab from './components/InsightsTab';
import SessionIntelligenceTab from './components/SessionIntelligenceTab';
import NeoMetaTab from './components/NeoMetaTab';
import CreativeIntelligence from './components/CreativeIntelligence';
import CreativeStudio from './components/CreativeStudio';
import ExchangeRateDebug from './components/ExchangeRateDebug';
import CurrencyToggle from './components/CurrencyToggle';
import LiveCheckoutIndicator from './components/LiveCheckoutIndicator';
import CampaignLauncher from './components/CampaignLauncher';
import ProductRadar from './components/ProductRadar';
import CustomerInsightsTab from './components/CustomerInsightsTab';

// Fixed "Connected" badge component
const ConnectedBadge = () => (
  <div 
    className="fixed bottom-2 right-2 text-gray-500 pointer-events-none z-50"
    style={{ fontSize: '10px', opacity: 0.6 }}
  >
    Connected
  </div>
);

const API_BASE = '/api';

const fetchJson = async (url, fallback = null, options = {}) => {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    if (!text) return fallback;

    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse JSON for', url, parseError);
      return fallback;
    }
  } catch (error) {
    console.error('Error fetching', url, error);
    return fallback;
  }
};

const getLocalDateString = (date = new Date()) => {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(date.getTime() - offsetMs);
  return localDate.toISOString().split('T')[0];
};

const getIstanbulDateString = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date);

const getMonthKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const parseMonthKey = (key) => {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return null;
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return null;
  return { year, monthIndex: month - 1 };
};

const getMonthLabel = (key) => {
  const parsed = parseMonthKey(key);
  if (!parsed) return '';
  return `${MONTH_NAMES[parsed.monthIndex]} ${parsed.year}`;
};

const getMonthBounds = (key) => {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  const { year, monthIndex } = parsed;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return {
    startDate: getLocalDateString(start),
    endDate: getLocalDateString(end),
    year,
    monthIndex,
    daysInMonth: end.getDate(),
    label: `${MONTH_NAMES[monthIndex]} ${year}`
  };
};

const getPreviousMonthKey = (key) => {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  const { year, monthIndex } = parsed;
  const prev = new Date(year, monthIndex - 1, 1);
  return getMonthKey(prev);
};

const EPSILON = 1e-6;
const K_PRIOR = 50;
const CREATIVE_SAMPLES = 2000;
const ALL_CAMPAIGNS_ID = 'all-campaigns';
const EUROPE_COUNTRY_CODES = new Set([
  'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI',
  'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'XK', 'LV', 'LI', 'LT', 'LU', 'MT',
  'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK',
  'SI', 'ES', 'SE', 'CH', 'UA', 'GB', 'VA'
]);
const USA_COUNTRY_CODES = new Set(['US']);
const REGION_COMPARE_COLORS = {
  europe: '#2563eb',
  usa: '#ef4444'
};
const CTR_TREND_COLORS = ['#2563eb', '#f97316', '#10b981'];
const CTR_COMPARE_LIMIT = 3;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + toNumber(item), 0);
  }
  if (value && typeof value === 'object' && 'value' in value) return Number(value.value);
  return 0;
};

const getMean = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / values.length;
};

const getStandardDeviation = (values = [], mean = getMean(values)) => {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const variance = values.reduce((sum, value) => {
    const diff = (Number.isFinite(value) ? value : 0) - mean;
    return sum + diff * diff;
  }, 0) / values.length;
  return Math.sqrt(variance);
};

const getLinearRegressionStats = (values = []) => {
  const n = values.length;
  if (n < 2) {
    return { slope: 0, intercept: values[0] || 0, r2: 0 };
  }

  const meanX = (n - 1) / 2;
  const meanY = getMean(values);
  let num = 0;
  let den = 0;
  let ssTot = 0;
  let ssRes = 0;

  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = Number.isFinite(values[i]) ? values[i] : 0;
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) * (x - meanX);
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  for (let i = 0; i < n; i += 1) {
    const y = Number.isFinite(values[i]) ? values[i] : 0;
    const fitted = intercept + slope * i;
    ssRes += (y - fitted) * (y - fitted);
    ssTot += (y - meanY) * (y - meanY);
  }

  const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
  return { slope, intercept, r2 };
};

const getMovingAverage = (values = [], windowSize = 7) => {
  if (!Array.isArray(values) || values.length === 0) return [];
  const window = Math.max(1, Math.floor(windowSize));
  const result = [];

  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const avg = getMean(slice);
    result.push(avg);
  }

  return result;
};

const getFirstPositiveMetric = (...values) => {
  for (const value of values) {
    const num = toNumber(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
};

const getVisitsProxy = ({ landingPageViews, outboundClicks, inlineLinkClicks }) =>
  getFirstPositiveMetric(landingPageViews, outboundClicks, inlineLinkClicks);

const CREATIVE_FUNNEL_SUMMARY_PROMPTS = {
  analyze: 'Without ad-hoc reasoning and rigorous thinking analyze these ads numbers and provide rigorous insights. Interpret the funnel numbers → diagnose what changed + why → give prioritized actions/tests. Keep verbosity low.',
  summarize: 'Show what changed and organize data in a readable meaningful way, to be comprehended at a glance. Keep verbosity low.'
};

const hashStringToSeed = (value) => {
  const str = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sampleNormal = (rng) => {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const sampleGamma = (shape, rng) => {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(1 + shape, rng) * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = sampleNormal(rng);
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};

const sampleBeta = (alpha, beta, rng) => {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const total = x + y;
  return total === 0 ? 0 : x / total;
};

const percentileFromSamples = (samples, percentile) => {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const getCreativeDataStrength = (visits) => {
  if (visits >= 200) return { key: 'HIGH', label: 'HIGH DATA' };
  if (visits >= 50) return { key: 'MED', label: 'MED DATA' };
  return { key: 'LOW', label: 'LOW DATA' };
};

const getCreativeVerdict = ({ visits, winProb, p10, baselineCvr }) => {
  const strength = getCreativeDataStrength(visits).key;

  if (visits <= 0 || !Number.isFinite(winProb) || !Number.isFinite(p10)) {
    return { label: 'NEUTRAL ⚪', key: 'NEUTRAL' };
  }

  if (strength === 'HIGH' && winProb <= 0.1) return { label: 'DEAD ❌', key: 'DEAD' };
  if (strength === 'HIGH' && winProb <= 0.3) return { label: 'LOSER 🔻', key: 'LOSER' };
  if (strength === 'HIGH' && winProb >= 0.95 && p10 > baselineCvr) {
    return { label: 'WINNER ✅', key: 'WINNER' };
  }
  if (strength !== 'LOW' && winProb >= 0.7) {
    return { label: 'PROMISING 🟡', key: 'PROMISING' };
  }
  if (winProb >= 0.3) return { label: 'NEUTRAL ⚪', key: 'NEUTRAL' };

  return { label: 'NEUTRAL ⚪', key: 'NEUTRAL' };
};

const computeCreativeBayesianStats = ({ visits, effectivePurchases, baselineCvr, seedKey }) => {
  if (visits <= 0) {
    return {
      pointCvr: null,
      winProb: null,
      p10: null,
      p90: null
    };
  }

  const alpha0 = 1 + K_PRIOR * baselineCvr;
  const beta0 = 1 + K_PRIOR * (1 - baselineCvr);
  const alpha = alpha0 + effectivePurchases;
  const beta = beta0 + (visits - effectivePurchases);
  const rng = createSeededRng(hashStringToSeed(seedKey));
  const samples = [];
  let wins = 0;

  for (let i = 0; i < CREATIVE_SAMPLES; i += 1) {
    const sample = sampleBeta(alpha, beta, rng);
    samples.push(sample);
    if (sample > baselineCvr) wins += 1;
  }

  return {
    pointCvr: visits > 0 ? effectivePurchases / visits : null,
    winProb: wins / CREATIVE_SAMPLES,
    p10: percentileFromSamples(samples, 0.1),
    p90: percentileFromSamples(samples, 0.9)
  };
};

const countryCodeToFlag = (code) => {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return '🏳️';
  return String.fromCodePoint(...code.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0)));
};

const MASTER_COUNTRIES_WITH_FLAGS = MASTER_COUNTRIES.map(country => ({
  ...country,
  flag: countryCodeToFlag(country.code)
}));

const VironaMark = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 96 96"
    role="img"
    aria-hidden="true"
    className={className}
  >
    <path
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      d="M48 4 92 48 48 92 4 48 48 4Zm0 18 26 26-26 26L22 48 48 22Zm0 14 12 12-12 12-12-12 12-12Z"
    />
  </svg>
);

const STORES = {
  vironax: {
    id: 'vironax',
    name: 'Virona',
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

const TABS = ['Dashboard', 'Metrics Charts', 'Attribution', 'Insights', 'Session Intelligence', 'NeoMeta', 'Customer Insights', 'Budget Efficiency', 'Budget Intelligence', 'Manual Data', 'Fatigue Detector', 'Creative Analysis 🎨 📊', 'Creative Studio ✨', 'AI Analytics', 'AI Budget', 'Budget Calculator', 'Exchange Rates', 'Campaign Launcher', 'Product Radar'];
const PRODUCT_RADAR_TAB_INDEX = TABS.indexOf('Product Radar');
const TABS_VERSION = '2026-01-31-customer-insights-after-neometa-v1';

export default function App() {
  const [currentStore, setCurrentStore] = useState('vironax');
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const savedLabel = localStorage.getItem('activeTabLabel');
      if (savedLabel) {
        const idx = TABS.indexOf(savedLabel);
        if (idx >= 0) return idx;
      }

      const saved = localStorage.getItem('activeTab');
      const parsed = Number(saved);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed < TABS.length) {
        // Migration: rely on stored tab label for reordering.
        return parsed;
      }
    } catch (e) {
      console.error('Error reading localStorage:', e);
    }
    return 0;
  });
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  
  const [dateRange, setDateRange] = useState({ type: 'days', value: 7 });
  const [customRange, setCustomRange] = useState({
    start: getLocalDateString(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)),
    end: getLocalDateString()
  });
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const [selectedMonthKey, setSelectedMonthKey] = useState(() => getMonthKey());
  const [monthMode, setMonthMode] = useState('projection');

  const monthOptions = useMemo(() => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 12; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = getMonthKey(date);
      options.push({ key, label: getMonthLabel(key) });
    }
    return options;
  }, []);

  const applyMonthSelection = useCallback((monthKey, mode) => {
    const bounds = getMonthBounds(monthKey);
    if (!bounds) return;
    const todayKey = getLocalDateString();
    const isCurrentMonth = monthKey === getMonthKey();
    const start = bounds.startDate;
    const end = (mode === 'mtd' && isCurrentMonth) ? todayKey : bounds.endDate;
    setDateRange({ type: 'custom', start, end });
    setCustomRange({ start, end });
    setShowCustomPicker(false);
  }, [setCustomRange, setDateRange, setShowCustomPicker]);

  const handleMonthChange = useCallback((nextKey) => {
    setSelectedMonthKey(nextKey);
    applyMonthSelection(nextKey, monthMode);
  }, [applyMonthSelection, monthMode]);

  const handleMonthModeChange = useCallback((nextMode) => {
    setMonthMode(nextMode);
    applyMonthSelection(selectedMonthKey, nextMode);
  }, [applyMonthSelection, selectedMonthKey]);
  
  const [dashboard, setDashboard] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [efficiencyTrends, setEfficiencyTrends] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [budgetIntelligence, setBudgetIntelligence] = useState(null);
  const [customerInsights, setCustomerInsights] = useState(null);
  const [customerInsightsLoading, setCustomerInsightsLoading] = useState(false);
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
  const [countryTrendsRangeMode, setCountryTrendsRangeMode] = useState('global'); // 'global' | 'quick'
  const [countryTrendsQuickRange, setCountryTrendsQuickRange] = useState({ type: 'weeks', value: 2 });
  const [campaignTrendsRangeMode, setCampaignTrendsRangeMode] = useState('global'); // 'global' | 'quick'
  const [campaignTrendsQuickRange, setCampaignTrendsQuickRange] = useState({ type: 'weeks', value: 2 });
  const [nyTrendData, setNyTrendData] = useState(null);
  const [nyTrendDataSource, setNyTrendDataSource] = useState('');
  const [campaignTrends, setCampaignTrends] = useState([]);
  const [campaignTrendsDataSource, setCampaignTrendsDataSource] = useState('');
  const [countriesDataSource, setCountriesDataSource] = useState('');
  const [regionCompareTrends, setRegionCompareTrends] = useState([]);
  const [regionCompareEnabled, setRegionCompareEnabled] = useState(false);
  const [chartMode, setChartMode] = useState('bucket');

  // Unified analytics section state (must be before useEffect hooks that use them)
  const [analyticsMode, setAnalyticsMode] = useState('meta-ad-manager'); // 'countries' | 'meta-ad-manager'
  const [metaAdManagerData, setMetaAdManagerData] = useState([]);
  const [metaAdManagerNotice, setMetaAdManagerNotice] = useState('');
  const [adManagerBreakdown, setAdManagerBreakdown] = useState('none'); // 'none', 'country', 'age', 'gender', 'age_gender', 'placement'
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());
  const [expandedAdsets, setExpandedAdsets] = useState(new Set());

  // Funnel diagnostics state
  const [funnelDiagnostics, setFunnelDiagnostics] = useState(null);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(true);
  const [selectedDiagnosticsCampaign, setSelectedDiagnosticsCampaign] = useState(null);

  // Hide/show campaigns state
  const [hiddenCampaigns, setHiddenCampaigns] = useState(new Set());
  const [showHiddenDropdown, setShowHiddenDropdown] = useState(false);

  // Include inactive campaigns/adsets/ads toggle (default: ACTIVE only)
  const [includeInactive, setIncludeInactive] = useState(false);
  // Campaign scope selector
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [campaignOptions, setCampaignOptions] = useState([]);

  const diagnosticsCampaignOptions = useMemo(() => {
    if (!Array.isArray(metaAdManagerData)) return [];

    const unique = new Map();

    metaAdManagerData.forEach((campaign) => {
      if (campaign?.campaign_id && campaign?.campaign_name) {
        unique.set(campaign.campaign_id, campaign.campaign_name);
      }
    });

    return Array.from(unique, ([value, label]) => ({ value, label }));
  }, [metaAdManagerData]);

  const store = STORES[currentStore];
  const selectedCampaignOption = useMemo(
    () => campaignOptions.find((c) => c.campaignId === selectedCampaignId) || null,
    [campaignOptions, selectedCampaignId]
  );
  const campaignScopeLabel = selectedCampaignOption?.campaignName || 'All Campaigns';

  const renderStoreAvatar = (storeId) => {
    if (storeId === 'vironax') {
      return (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
          <VironaMark className="h-5 w-5 text-indigo-700" />
        </span>
      );
    }

    if (storeId === 'shawq') {
      return (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
          <img
            src="/shawq-logo.svg"
            alt="Shawq logo"
            className="h-5 w-5"
          />
        </span>
      );
    }

    const initial = storeId?.[0] ? storeId[0].toUpperCase() : '?';
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 font-semibold">
        {initial}
      </span>
    );
  };

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
      const savedIncludeInactive = localStorage.getItem('includeInactive');
      if (savedIncludeInactive !== null) {
        setIncludeInactive(savedIncludeInactive === 'true');
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
    if (!storeLoaded) return;
    try {
      localStorage.setItem('includeInactive', includeInactive ? 'true' : 'false');
    } catch (e) {
      console.error('Error writing localStorage:', e);
    }
  }, [includeInactive, storeLoaded]);

  useEffect(() => {
    if (!storeLoaded) return;
    try {
      localStorage.setItem('activeTab', String(activeTab));
      localStorage.setItem('activeTabLabel', TABS[activeTab] || '');
      localStorage.setItem('tabsVersion', TABS_VERSION);
    } catch (e) {
      console.error('Error writing localStorage:', e);
    }
  }, [activeTab, storeLoaded]);

  useEffect(() => {
    const newStore = STORES[currentStore];
    setOrderForm(prev => ({
      ...prev,
      country: currentStore === 'vironax' ? 'SA' : 'US',
      revenue: newStore.defaultAOV
    }));
  }, [currentStore]);

  // Reset campaign scope when switching stores
  useEffect(() => {
    setSelectedCampaignId('');
    setCampaignOptions([]);
  }, [currentStore]);

  // Ensure campaign selection remains valid as options change
  useEffect(() => {
    if (!selectedCampaignId) return;
    const exists = campaignOptions.some((c) => c.campaignId === selectedCampaignId);
    if (!exists && campaignOptions.length > 0) {
      setSelectedCampaignId('');
    }
  }, [campaignOptions, selectedCampaignId]);


  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ store: currentStore });
      const budgetParams = new URLSearchParams({
        store: currentStore,
        startDate: '2000-01-01',
        endDate: getLocalDateString()
      });
      const countryTrendParams = new URLSearchParams({ store: currentStore });
      const regionCompareParams = new URLSearchParams({ store: currentStore });
      const campaignTrendParams = new URLSearchParams({ store: currentStore });
      if (selectedCampaignId) {
        params.set('campaignId', selectedCampaignId);
        budgetParams.set('campaignId', selectedCampaignId);
        countryTrendParams.set('campaignId', selectedCampaignId);
        campaignTrendParams.set('campaignId', selectedCampaignId);
      }
      const applyDashboardRange = (targetParams) => {
        if (dateRange.type === 'custom') {
          targetParams.set('startDate', dateRange.start);
          targetParams.set('endDate', dateRange.end);
        } else if (dateRange.type === 'yesterday') {
          targetParams.set('yesterday', '1');
        } else {
          targetParams.set(dateRange.type, dateRange.value);
        }
      };
      const applyCountryTrendsRange = (targetParams) => {
        if (countryTrendsRangeMode === 'quick') {
          const quickRange = countryTrendsQuickRange || { type: 'weeks', value: 2 };
          if (quickRange.type === 'custom') {
            if (quickRange.start && quickRange.end) {
              targetParams.set('startDate', quickRange.start);
              targetParams.set('endDate', quickRange.end);
            }
            return;
          }
          if (quickRange.type === 'yesterday') {
            targetParams.set('yesterday', '1');
            return;
          }
          if (quickRange.type && quickRange.value) {
            targetParams.set(quickRange.type, quickRange.value);
            return;
          }
          targetParams.set('weeks', 2);
          return;
        }
        applyDashboardRange(targetParams);
      };
      const applyCampaignTrendsRange = (targetParams) => {
        if (campaignTrendsRangeMode === 'quick') {
          const quickRange = campaignTrendsQuickRange || { type: 'weeks', value: 2 };
          if (quickRange.type === 'custom') {
            if (quickRange.start && quickRange.end) {
              targetParams.set('startDate', quickRange.start);
              targetParams.set('endDate', quickRange.end);
            }
            return;
          }
          if (quickRange.type === 'yesterday') {
            targetParams.set('yesterday', '1');
            return;
          }
          if (quickRange.type && quickRange.value) {
            targetParams.set(quickRange.type, quickRange.value);
            return;
          }
          targetParams.set('weeks', 2);
          return;
        }
        applyDashboardRange(targetParams);
      };
      
      // Fix 7: Always show arrows for comparison (Today compares to Yesterday, Yesterday compares to day before)
      const shouldShowArrows = true;

      applyDashboardRange(params);
      applyCountryTrendsRange(countryTrendParams);
      applyCampaignTrendsRange(campaignTrendParams);
      applyDashboardRange(regionCompareParams);
      
      params.set('showArrows', shouldShowArrows);

      // Include inactive campaigns/adsets/ads if toggle is on
      if (includeInactive) {
        params.set('includeInactive', 'true');
        budgetParams.set('includeInactive', 'true');
        countryTrendParams.set('includeInactive', 'true');
        campaignTrendParams.set('includeInactive', 'true');
        regionCompareParams.set('includeInactive', 'true');
      }

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
        regionCompare,
        nyTrend,
        campaignTrendData,
        timeOfDayData,
        dowData
      ] = await Promise.all([
        fetchJson(`${API_BASE}/analytics/dashboard?${params}`, {}),
        fetchJson(`${API_BASE}/analytics/efficiency?${params}`, {}),
        fetchJson(`${API_BASE}/analytics/efficiency/trends?${params}`, []),
        fetchJson(`${API_BASE}/analytics/recommendations?${params}`, []),
        fetchJson(`${API_BASE}/budget-intelligence?${budgetParams}`, {}),
        fetchJson(`${API_BASE}/manual?${params}`, []),
        fetchJson(`${API_BASE}/manual/spend?${params}`, []),
        fetchJson(`${API_BASE}/analytics/countries?store=${currentStore}`, MASTER_COUNTRIES_WITH_FLAGS),
        fetchJson(`${API_BASE}/analytics/countries/trends?${countryTrendParams}`, { data: [], dataSource: '' }),
        fetchJson(`${API_BASE}/analytics/countries/trends?${regionCompareParams}`, { data: [], dataSource: '' }),
        fetchJson(`${API_BASE}/analytics/newyork/trends?${countryTrendParams}`, { data: null, dataSource: '' }),
        fetchJson(`${API_BASE}/analytics/campaigns/trends?${campaignTrendParams}`, { data: [], dataSource: '' }),
        // Time of day - now fetches for both stores
        fetchJson(`${API_BASE}/analytics/time-of-day?${timeOfDayParams}`, { data: [], timezone: null, sampleTimestamps: [], source: '', message: '' }),
        // Days of week
        fetchJson(`${API_BASE}/analytics/days-of-week?store=${currentStore}&period=${daysOfWeekPeriod}`, { data: [], source: '', totalOrders: 0, period: daysOfWeekPeriod })
      ]);

      setDashboard(dashData || {});
      setEfficiency(effData || {});
      setEfficiencyTrends(Array.isArray(effTrends) ? effTrends : []);
      setRecommendations(Array.isArray(recs) ? recs : []);

      const normalizedIntel = intel?.data || intel || {};
      setBudgetIntelligence(normalizedIntel);
      setManualOrders(Array.isArray(orders) ? orders : []);
      setManualSpendOverrides(Array.isArray(spendOverrides) ? spendOverrides : []);

      const dashCampaigns = Array.isArray(dashData?.campaigns) ? dashData.campaigns : [];
      setCampaignOptions((prev) => {
        const map = new Map();
        const addCampaign = (campaign) => {
          const id = campaign?.campaignId || campaign?.campaign_id || campaign?.id;
          const name = campaign?.campaignName || campaign?.campaign_name || campaign?.name;
          if (id && name) {
            map.set(id, { campaignId: id, campaignName: name });
          }
        };

        prev.forEach(addCampaign);
        dashCampaigns.forEach(addCampaign);

        return Array.from(map.values())
          .filter((c) => c.campaignId && c.campaignName)
          .sort((a, b) => a.campaignName.localeCompare(b.campaignName));
      });

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

      if (regionCompare && typeof regionCompare === 'object' && Array.isArray(regionCompare.data)) {
        setRegionCompareTrends(regionCompare.data);
      } else if (Array.isArray(regionCompare)) {
        setRegionCompareTrends(regionCompare);
      } else {
        setRegionCompareTrends([]);
      }

      // Handle New York trend - returns { data: {...} or null, dataSource: ... }
      if (nyTrend && typeof nyTrend === 'object' && nyTrend.data) {
        setNyTrendData(nyTrend.data);
        setNyTrendDataSource(nyTrend.dataSource || '');
      } else {
        setNyTrendData(null);
        setNyTrendDataSource('');
      }

      if (campaignTrendData && typeof campaignTrendData === 'object' && Array.isArray(campaignTrendData.data)) {
        setCampaignTrends(campaignTrendData.data);
        setCampaignTrendsDataSource(campaignTrendData.dataSource || '');
      } else if (Array.isArray(campaignTrendData)) {
        setCampaignTrends(campaignTrendData);
        setCampaignTrendsDataSource('');
      } else {
        setCampaignTrends([]);
        setCampaignTrendsDataSource('');
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
  }, [currentStore, dateRange, selectedShopifyRegion, daysOfWeekPeriod, includeInactive, countryTrendsRangeMode, countryTrendsQuickRange, campaignTrendsRangeMode, campaignTrendsQuickRange, selectedCampaignId]);

  useEffect(() => {
    if (storeLoaded) {
      loadData();
    }
  }, [loadData, storeLoaded]);


  useEffect(() => {
    if (!storeLoaded) return;
    let ignore = false;

    const loadCustomerInsights = async () => {
      try {
        setCustomerInsightsLoading(true);
        const params = new URLSearchParams({ store: currentStore });
        if (dateRange.type === 'custom') {
          params.set('startDate', dateRange.start);
          params.set('endDate', dateRange.end);
        } else if (dateRange.type === 'yesterday') {
          params.set('yesterday', '1');
        } else {
          params.set(dateRange.type, dateRange.value);
        }

        const response = await fetchJson(`${API_BASE}/customer-insights?${params}`);
        if (!ignore) {
          setCustomerInsights(response?.data || null);
        }
      } catch (error) {
        console.error('Error loading customer insights:', error);
        if (!ignore) setCustomerInsights(null);
      } finally {
        if (!ignore) setCustomerInsightsLoading(false);
      }
    };

    loadCustomerInsights();
    return () => {
      ignore = true;
    };
  }, [currentStore, dateRange, storeLoaded]);

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

        if (selectedCampaignId) {
          params.set('campaignId', selectedCampaignId);
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
  }, [metaBreakdown, currentStore, dateRange, storeLoaded, selectedCampaignId]);

  // Load Meta Ad Manager hierarchy data
  useEffect(() => {
    if (!storeLoaded || analyticsMode !== 'meta-ad-manager') {
      setMetaAdManagerNotice('');
      return;
    }

    const isTodayRange = (range) => {
      if (range.type === 'days' && range.value === 1) return true;
      if (range.type === 'custom' && range.start && range.end) {
        const today = getIstanbulDateString();
        return range.start === today && range.end === today;
      }
      return false;
    };

    const buildParams = (range) => {
      const params = new URLSearchParams({ store: currentStore });

      if (range.type === 'custom') {
        params.set('startDate', range.start);
        params.set('endDate', range.end);
      } else if (range.type === 'yesterday') {
        params.set('yesterday', '1');
      } else {
        params.set(range.type, range.value);
      }

      if (adManagerBreakdown !== 'none') {
        params.set('breakdown', adManagerBreakdown);
      }

      // Include inactive if toggle is on
      if (includeInactive) {
        params.set('includeInactive', 'true');
      }

      if (selectedCampaignId) {
        params.set('campaignId', selectedCampaignId);
      }

      return params;
    };

    const fetchMetaAdManager = async (params) => {
      const response = await fetch(`${API_BASE}/analytics/meta-ad-manager?${params}`);
      const data = await response.json();
      return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    };

    async function loadMetaAdManager() {
      setMetaAdManagerNotice('');
      try {
        const params = buildParams(dateRange);
        const data = await fetchMetaAdManager(params);

        if (!data.length && isTodayRange(dateRange)) {
          const yesterday = getIstanbulDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
          const fallbackParams = buildParams({ type: 'custom', start: yesterday, end: yesterday });
          const fallbackData = await fetchMetaAdManager(fallbackParams);

          if (fallbackData.length > 0) {
            setMetaAdManagerData(fallbackData);
            setMetaAdManagerNotice(
              `Today's data is still syncing with Meta. Showing ${yesterday} results for now; we'll update automatically once today's data is ready.`
            );
            return;
          }

          setMetaAdManagerData([]);
          setMetaAdManagerNotice(
            "Today's data is still syncing with Meta, and yesterday's results aren't available yet. We'll update automatically as soon as data arrives."
          );
          return;
        }

        setMetaAdManagerData(data);
      } catch (error) {
        console.error('Error loading Meta Ad Manager data:', error);
        setMetaAdManagerData([]);
        setMetaAdManagerNotice('We had trouble loading Meta data just now. Please retry in a moment.');
      }
    }

    loadMetaAdManager();
  }, [analyticsMode, adManagerBreakdown, currentStore, dateRange, storeLoaded, includeInactive, selectedCampaignId]);

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

        // Add campaign filter if selected
        if (selectedDiagnosticsCampaign) {
          params.append('campaignId', selectedDiagnosticsCampaign);
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
  }, [currentStore, dateRange, storeLoaded, selectedDiagnosticsCampaign]);

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

  useEffect(() => {
    if (!selectedDiagnosticsCampaign) return;

    const hasCampaign = diagnosticsCampaignOptions.some(
      (option) => option.value === selectedDiagnosticsCampaign
    );

    if (!hasCampaign) {
      setSelectedDiagnosticsCampaign(null);
    }
  }, [diagnosticsCampaignOptions, selectedDiagnosticsCampaign]);

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

  // Hide/show campaign functions
  const toggleHideCampaign = (campaignId) => {
    setHiddenCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else {
        next.add(campaignId);
      }
      return next;
    });
  };

  const showAllCampaigns = () => {
    setHiddenCampaigns(new Set());
  };

  // Campaign selection for diagnostics
  const handleCampaignSelect = (campaignId) => {
    if (selectedDiagnosticsCampaign === campaignId) {
      setSelectedDiagnosticsCampaign(null); // Deselect
    } else {
      setSelectedDiagnosticsCampaign(campaignId); // Select
      setDiagnosticsExpanded(true); // Auto-expand diagnostics
    }
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
                  className="flex items-center gap-3 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  {renderStoreAvatar(currentStore)}
                  <div className="text-left">
                    <div className="font-bold text-gray-900 leading-tight">{store.name}</div>
                    <div className="text-xs text-gray-500 leading-tight">{store.tagline}</div>
                  </div>
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
                        <div className="flex items-center gap-3">
                          {renderStoreAvatar(s.id)}
                          <div>
                            <div className="font-semibold text-gray-900">{s.name}</div>
                            <div className="text-sm text-gray-500">
                              {s.tagline} • {s.ecommerce}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <CurrencyToggle
                value={displayCurrency}
                onChange={setDisplayCurrency}
                store={store?.id}
              />

              <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded">
                Dashboard
              </span>
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                {dashboard?.dateRange &&
                  `${dashboard.dateRange.startDate} to ${dashboard.dateRange.endDate}`}
              </span>
              <div className="flex flex-col items-end gap-1">
                <NotificationCenter currentStore={currentStore} />
                {store?.ecommerce === 'Shopify' && (
                  <LiveCheckoutIndicator store={currentStore} />
                )}
              </div>
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

          {/* Today & Yesterday */}
          <button
            onClick={() => { setDateRange({ type: 'days', value: 2 }); setShowCustomPicker(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange.type === 'days' && dateRange.value === 2
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            Today & Yesterday
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

          {/* Month Selector */}
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Month</span>
            <select
              value={selectedMonthKey}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {monthOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => handleMonthModeChange('mtd')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  monthMode === 'mtd'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500'
                }`}
              >
                MTD
              </button>
              <button
                type="button"
                onClick={() => handleMonthModeChange('projection')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  monthMode === 'projection'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500'
                }`}
                title="Full-month projection"
              >
                Full-month
              </button>
            </div>
          </div>

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

          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Trend:</span>
            <div className="flex rounded-lg bg-gray-100 p-1">
              <button
                onClick={() => setChartMode('bucket')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  chartMode === 'bucket'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500'
                }`}
              >
                Buckets
              </button>
              <button
                onClick={() => setChartMode('ma')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  chartMode === 'ma'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500'
                }`}
              >
                MA
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <span className="text-sm font-medium text-gray-700">USA vs Europe Overlay</span>
            <button
              type="button"
              onClick={() => setRegionCompareEnabled((prev) => !prev)}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                regionCompareEnabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  regionCompareEnabled ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <div>
              Showing: <strong>{getDateRangeLabel()}</strong>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Campaign:</span>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[180px]"
              >
                <option value="">All campaigns</option>
                {campaignOptions.map((option) => (
                  <option key={option.campaignId} value={option.campaignId}>
                    {option.campaignName}
                  </option>
                ))}
              </select>
            </div>
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
            campaignScopeLabel={campaignScopeLabel}
            availableCountries={availableCountries}
            nyTrendData={nyTrendData}
            diagnosticsCampaignOptions={diagnosticsCampaignOptions}
            countryTrends={countryTrends}
            countryTrendsDataSource={countryTrendsDataSource}
            countryTrendsRangeMode={countryTrendsRangeMode}
            setCountryTrendsRangeMode={setCountryTrendsRangeMode}
            countryTrendsQuickRange={countryTrendsQuickRange}
            setCountryTrendsQuickRange={setCountryTrendsQuickRange}
            campaignTrendsRangeMode={campaignTrendsRangeMode}
            setCampaignTrendsRangeMode={setCampaignTrendsRangeMode}
            campaignTrendsQuickRange={campaignTrendsQuickRange}
            setCampaignTrendsQuickRange={setCampaignTrendsQuickRange}
            campaignTrends={campaignTrends}
            campaignTrendsDataSource={campaignTrendsDataSource}
            countriesDataSource={countriesDataSource}
            regionCompareTrends={regionCompareTrends}
            regionCompareEnabled={regionCompareEnabled}
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
            metaAdManagerNotice={metaAdManagerNotice}
            adManagerBreakdown={adManagerBreakdown}
            setAdManagerBreakdown={setAdManagerBreakdown}
            expandedCampaigns={expandedCampaigns}
            setExpandedCampaigns={setExpandedCampaigns}
            expandedAdsets={expandedAdsets}
            setExpandedAdsets={setExpandedAdsets}
            funnelDiagnostics={funnelDiagnostics}
            diagnosticsExpanded={diagnosticsExpanded}
            setDiagnosticsExpanded={setDiagnosticsExpanded}
            selectedDiagnosticsCampaign={selectedDiagnosticsCampaign}
            setSelectedDiagnosticsCampaign={setSelectedDiagnosticsCampaign}
            hiddenCampaigns={hiddenCampaigns}
            setHiddenCampaigns={setHiddenCampaigns}
            showHiddenDropdown={showHiddenDropdown}
            setShowHiddenDropdown={setShowHiddenDropdown}
            includeInactive={includeInactive}
            selectedCampaignId={selectedCampaignId}
            setIncludeInactive={setIncludeInactive}
            selectedMonthKey={selectedMonthKey}
            monthMode={monthMode}
            dateRange={dashboard?.dateRange}
            chartMode={chartMode}
          />
          )}

        {activeTab === 1 && (
          <MetricsChartsTab
            metaAdManagerData={metaAdManagerData}
            dashboard={dashboard}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
            campaignScopeLabel={campaignScopeLabel}
          />
        )}

        {activeTab === 2 && (
          <AttributionTab
            store={store}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}

        {activeTab === 3 && (
          <InsightsTab
            store={store}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}

        {activeTab === 4 && (
          <SessionIntelligenceTab store={store} />
        )}

        {activeTab === 5 && (
          <NeoMetaTab />
        )}

        {activeTab === 6 && (
          <CustomerInsightsTab
            data={customerInsights}
            loading={customerInsightsLoading}
            formatCurrency={formatCurrency}
            store={store}
          />
        )}

        {activeTab === 7 && efficiency && (
          <EfficiencyTab
            efficiency={efficiency}
            trends={efficiencyTrends}
            recommendations={recommendations}
            formatCurrency={formatCurrency}
          />
        )}

        {activeTab === 8 && budgetIntelligence && (
          <BudgetIntelligenceTab
            data={budgetIntelligence}
            formatCurrency={formatCurrency}
            store={store}
          />
        )}

        {activeTab === 9 && (
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

        {activeTab === 10 && (
          <FatigueDetector
            store={store}
            formatCurrency={formatCurrency}
          />
        )}

        {activeTab === 11 && (
          <>
            <CreativeIntelligence store={currentStore} />
            <CreativeAnalysis store={store} />
          </>
        )}

        {activeTab === 12 && (
          <CreativeStudio store={currentStore} />
        )}

        {activeTab === 13 && (
          <AIAnalytics
            store={store}
          />
        )}

        {activeTab === 14 && (
          <AIBudget store={currentStore} />
        )}

        {activeTab === 15 && (
          <BudgetCalculator
            campaigns={budgetIntelligence?.campaignCountryGuidance || budgetIntelligence?.liveGuidance || []}
            periodDays={budgetIntelligence?.period?.days || 30}
            storeName={store?.id}
          />
        )}

        {activeTab === 16 && (
          <ExchangeRateDebug />
        )}

        {activeTab === 17 && (
          <CampaignLauncher store={store} />
        )}

        {activeTab === PRODUCT_RADAR_TAB_INDEX && (
          <ProductRadar />
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
  campaignScopeLabel = 'All Campaigns',
  availableCountries = [],
  nyTrendData = null,
  countryTrends = [],
  countryTrendsDataSource = '',
  countryTrendsRangeMode = 'global',
  setCountryTrendsRangeMode = () => {},
  countryTrendsQuickRange = { type: 'weeks', value: 2 },
  setCountryTrendsQuickRange = () => {},
  campaignTrendsRangeMode = 'global',
  setCampaignTrendsRangeMode = () => {},
  campaignTrendsQuickRange = { type: 'weeks', value: 2 },
  setCampaignTrendsQuickRange = () => {},
  campaignTrends = [],
  campaignTrendsDataSource = '',
  countriesDataSource = '',
  regionCompareTrends = [],
  regionCompareEnabled = false,
  timeOfDay = { data: [], timezone: 'America/Chicago', sampleTimestamps: [], source: '' },
  selectedShopifyRegion = 'us',
  setSelectedShopifyRegion = () => {},
  daysOfWeek = { data: [], source: '', totalOrders: 0, period: '14d' },
  daysOfWeekPeriod = '14d',
  setDaysOfWeekPeriod = () => {},
  loading = false,
  analyticsMode = 'meta-ad-manager',
  setAnalyticsMode = () => {},
  metaAdManagerData = [],
  metaAdManagerNotice = '',
  adManagerBreakdown = 'none',
  setAdManagerBreakdown = () => {},
  expandedCampaigns = new Set(),
  setExpandedCampaigns = () => {},
  expandedAdsets = new Set(),
  setExpandedAdsets = () => {},
  funnelDiagnostics = null,
  diagnosticsExpanded = true,
  setDiagnosticsExpanded = () => {},
  selectedDiagnosticsCampaign = null,
  setSelectedDiagnosticsCampaign = () => {},
  hiddenCampaigns = new Set(),
  setHiddenCampaigns = () => {},
  showHiddenDropdown = false,
  setShowHiddenDropdown = () => {},
  includeInactive = false,
  setIncludeInactive = () => {},
  selectedCampaignId = '',
  selectedMonthKey = '',
  monthMode = 'projection',
  dateRange = {},
  chartMode = 'bucket',
  diagnosticsCampaignOptions = [],
}) {
  const { overview = {}, trends = {}, campaigns = [], countries = [], diagnostics = {} } = dashboard || {};

  const [countrySortConfig, setCountrySortConfig] = useState({ field: 'totalOrders', direction: 'desc' });
  const [campaignSortConfig, setCampaignSortConfig] = useState({ field: 'spend', direction: 'desc' });
  const [showCountryTrends, setShowCountryTrends] = useState(false);
  const [showCampaignTrends, setShowCampaignTrends] = useState(false);
  const [metaView, setMetaView] = useState('campaign'); // 'campaign' | 'country'
  const [showMetaBreakdown, setShowMetaBreakdown] = useState(false); // Section 2 collapse
  const [expandedCountries, setExpandedCountries] = useState(new Set());
  const [expandedStates, setExpandedStates] = useState(new Set());
  const [selectedCreativeCampaignId, setSelectedCreativeCampaignId] = useState(null);
  const [creativeSortConfig, setCreativeSortConfig] = useState({ field: 'purchases', direction: 'desc' });
  const [creativeViewMode, setCreativeViewMode] = useState('aggregate'); // 'aggregate' | 'country'
  const [creativeSummaryGeneratedAt, setCreativeSummaryGeneratedAt] = useState(null);
  const [creativeSummaryRange, setCreativeSummaryRange] = useState(() => (
    dateRange?.startDate && dateRange?.endDate
      ? { type: 'custom', start: dateRange.startDate, end: dateRange.endDate }
      : { type: 'days', value: 7 }
  ));
  const [creativeSummaryCustomRange, setCreativeSummaryCustomRange] = useState(() => ({
    start: dateRange?.startDate || '',
    end: dateRange?.endDate || ''
  }));
  const [showCreativeSummaryCustomPicker, setShowCreativeSummaryCustomPicker] = useState(false);
  const [creativeSummaryData, setCreativeSummaryData] = useState([]);
  const [creativeSummaryPreviousData, setCreativeSummaryPreviousData] = useState([]);
  const [creativeSummaryLoading, setCreativeSummaryLoading] = useState(false);
  const [creativeSummaryRefreshTick, setCreativeSummaryRefreshTick] = useState(0);
  const [creativeInsightPanelOpen, setCreativeInsightPanelOpen] = useState(true);
  const [creativeInsightMode, setCreativeInsightMode] = useState('analyze');
  const [creativeInsightPrompts, setCreativeInsightPrompts] = useState(() => ({
    analyze: CREATIVE_FUNNEL_SUMMARY_PROMPTS.analyze,
    summarize: CREATIVE_FUNNEL_SUMMARY_PROMPTS.summarize
  }));
  const [creativeInsightVerbosity, setCreativeInsightVerbosity] = useState(() => ({
    analyze: 'low',
    summarize: 'low'
  }));
  const [creativeInsightAutoEnabled, setCreativeInsightAutoEnabled] = useState(true);
  const [creativeInsightSummary, setCreativeInsightSummary] = useState(null);
  const [creativeInsightLoading, setCreativeInsightLoading] = useState(false);
  const [creativeInsightStreamingText, setCreativeInsightStreamingText] = useState('');
  const [creativeInsightError, setCreativeInsightError] = useState('');
  const DEFAULT_CREATIVE_INSIGHT_LLM = { provider: 'openai', model: '', temperature: 1.0 };
  const [creativeInsightLlm, setCreativeInsightLlm] = useState(() => {
    try {
      const raw = localStorage.getItem('creativeInsightLlm');
      if (!raw) return DEFAULT_CREATIVE_INSIGHT_LLM;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return DEFAULT_CREATIVE_INSIGHT_LLM;
      return {
        provider: typeof parsed.provider === 'string' ? parsed.provider : DEFAULT_CREATIVE_INSIGHT_LLM.provider,
        model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_CREATIVE_INSIGHT_LLM.model,
        temperature: Number.isFinite(Number(parsed.temperature)) ? Number(parsed.temperature) : DEFAULT_CREATIVE_INSIGHT_LLM.temperature
      };
    } catch (e) {
      return DEFAULT_CREATIVE_INSIGHT_LLM;
    }
  });
  const [showCreativeSummaryTable, setShowCreativeSummaryTable] = useState(true);
  const [showCreativeFunnelSummary, setShowCreativeFunnelSummary] = useState(true);
  const [ctrTrendRangeMode, setCtrTrendRangeMode] = useState('dashboard'); // 'dashboard' | 'local'
  const [ctrTrendRange, setCtrTrendRange] = useState({ type: 'days', value: 7 });
  const [ctrTrendCustomRange, setCtrTrendCustomRange] = useState(() => ({
    start: dateRange?.startDate || '',
    end: dateRange?.endDate || ''
  }));
  const [showCtrTrendCustomPicker, setShowCtrTrendCustomPicker] = useState(false);
  const [ctrTrendIncludeInactive, setCtrTrendIncludeInactive] = useState(false);
  const [ctrTrendCountry, setCtrTrendCountry] = useState('ALL');
  const [ctrTrendAdId, setCtrTrendAdId] = useState('ALL');
  // null = auto (derived from selectors); array = user-selected compare set
  const [ctrTrendCompareIds, setCtrTrendCompareIds] = useState(null);
  const [ctrTrendSeries, setCtrTrendSeries] = useState([]);
  const [ctrTrendLoading, setCtrTrendLoading] = useState(false);
  const [ctrTrendError, setCtrTrendError] = useState('');
  const [ctrTrendCompareError, setCtrTrendCompareError] = useState('');
  const [showOrdersTrend, setShowOrdersTrend] = useState(true);
  const [monthHistoryTrends, setMonthHistoryTrends] = useState([]);
  const [monthHistoryLoading, setMonthHistoryLoading] = useState(false);
  const [monthHistoryError, setMonthHistoryError] = useState('');
  const countryTrendQuickOptions = [
    { label: '1W', type: 'weeks', value: 1 },
    { label: '2W', type: 'weeks', value: 2 },
    { label: '3W', type: 'weeks', value: 3 },
    { label: '1M', type: 'months', value: 1 }
  ];

  useEffect(() => {
    let isActive = true;

    const loadMonthHistory = async () => {
      if (!store?.id) return;
      setMonthHistoryLoading(true);
      setMonthHistoryError('');

      const today = getLocalDateString();
      const params = new URLSearchParams({
        store: store.id,
        startDate: '2000-01-01',
        endDate: today
      });

      if (includeInactive) {
        params.set('includeInactive', 'true');
      }

      if (selectedCampaignId) {
        params.set('campaignId', selectedCampaignId);
      }

      try {
        const data = await fetchJson(`${API_BASE}/analytics/dashboard?${params}`, {});
        if (!isActive) return;
        const trendsData = Array.isArray(data?.trends) ? data.trends : [];
        setMonthHistoryTrends(trendsData);
        setMonthHistoryError('');
      } catch (error) {
        if (!isActive) return;
        setMonthHistoryTrends([]);
        setMonthHistoryError(error?.message || 'Failed to load month history');
      } finally {
        if (isActive) setMonthHistoryLoading(false);
      }
    };

    loadMonthHistory();

    return () => {
      isActive = false;
    };
  }, [store?.id, includeInactive, selectedCampaignId]);

  // Note: toggleHideCampaign, showAllCampaigns, and handleCampaignSelect
  // are now implemented in the UnifiedAnalytics component

  const ecomLabel = store.ecommerce;

  const monthHistoryDailyMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(monthHistoryTrends) ? monthHistoryTrends : []).forEach((point) => {
      if (!point?.date) return;
      map.set(point.date, {
        orders: toNumber(point.orders),
        revenue: toNumber(point.revenue),
        spend: toNumber(point.spend)
      });
    });
    return map;
  }, [monthHistoryTrends]);

  const monthlyTotals = useMemo(() => {
    const map = new Map();
    (Array.isArray(monthHistoryTrends) ? monthHistoryTrends : []).forEach((point) => {
      if (!point?.date) return;
      const monthKey = String(point.date).slice(0, 7);
      if (!map.has(monthKey)) {
        map.set(monthKey, { monthKey, revenue: 0, spend: 0, orders: 0 });
      }
      const entry = map.get(monthKey);
      entry.revenue += toNumber(point.revenue);
      entry.spend += toNumber(point.spend);
      entry.orders += toNumber(point.orders);
    });
    return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [monthHistoryTrends]);

  const monthlyTotalsMap = useMemo(() => (
    new Map(monthlyTotals.map((item) => [item.monthKey, item]))
  ), [monthlyTotals]);

  const getMetricValue = useCallback((totals = {}, metricKey = '') => {
    if (!totals) return 0;
    if (metricKey === 'revenue') return toNumber(totals.revenue);
    if (metricKey === 'spend') return toNumber(totals.spend);
    if (metricKey === 'orders') return toNumber(totals.orders);
    if (metricKey === 'aov') return totals.orders > 0 ? toNumber(totals.revenue) / toNumber(totals.orders) : 0;
    if (metricKey === 'cac') return totals.orders > 0 ? toNumber(totals.spend) / toNumber(totals.orders) : 0;
    if (metricKey === 'roas') return totals.spend > 0 ? toNumber(totals.revenue) / toNumber(totals.spend) : 0;
    return 0;
  }, []);

  const formatMetricValue = useCallback((metricKey, value) => {
    if (metricKey === 'roas') return `${(Number(value) || 0).toFixed(2)}x`;
    if (metricKey === 'orders') {
      const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
      return formatNumber ? formatNumber(safe) : Math.round(safe).toString();
    }
    if (['revenue', 'spend', 'aov', 'cac'].includes(metricKey)) {
      return formatCurrency ? formatCurrency(Number(value) || 0) : `${Number(value) || 0}`;
    }
    return `${Number(value) || 0}`;
  }, [formatCurrency, formatNumber]);

  const monthContext = useMemo(() => {
    const bounds = getMonthBounds(selectedMonthKey);
    if (!bounds) return null;

    const monthPrefix = `${MONTH_NAMES[bounds.monthIndex]} ${monthMode === 'projection' ? 'Projection' : 'MTD'}`;
    const prevKey = getPreviousMonthKey(selectedMonthKey);
    const prevParsed = parseMonthKey(prevKey);
    const prevLabel = prevParsed
      ? (prevParsed.year === bounds.year
        ? MONTH_NAMES[prevParsed.monthIndex]
        : `${MONTH_NAMES[prevParsed.monthIndex]} ${prevParsed.year}`)
      : 'last month';

    const emptyTotals = { revenue: 0, spend: 0, orders: 0 };

    if (monthHistoryError || (monthHistoryLoading && !monthHistoryTrends.length) || !monthHistoryTrends.length) {
      return {
        prefix: monthPrefix,
        prevLabel,
        activeTotals: emptyTotals,
        prevTotals: monthlyTotalsMap.get(prevKey) || emptyTotals,
        hasData: false,
        bounds
      };
    }

    const today = new Date();
    const todayKey = getLocalDateString(today);
    const isCurrentMonth = selectedMonthKey === getMonthKey(today);
    const monthEnd = isCurrentMonth ? todayKey : bounds.endDate;

    const monthPoints = monthHistoryTrends.filter((point) => (
      point?.date && point.date >= bounds.startDate && point.date <= monthEnd
    ));

    const totals = monthPoints.reduce((acc, point) => ({
      orders: acc.orders + toNumber(point.orders),
      revenue: acc.revenue + toNumber(point.revenue),
      spend: acc.spend + toNumber(point.spend)
    }), { orders: 0, revenue: 0, spend: 0 });

    let activeTotals = totals;

    if (isCurrentMonth && monthMode === 'projection') {
      const remainingDays = Math.max(bounds.daysInMonth - today.getDate(), 0);

      if (remainingDays > 0) {
        let paceOrders = 0;
        let paceRevenue = 0;
        let paceSpend = 0;
        let dayCount = 0;

        for (let offset = 1; offset <= 7; offset += 1) {
          const day = new Date(today);
          day.setDate(day.getDate() - offset);
          const dayKey = getLocalDateString(day);
          const entry = monthHistoryDailyMap.get(dayKey);
          if (entry) {
            paceOrders += toNumber(entry.orders);
            paceRevenue += toNumber(entry.revenue);
            paceSpend += toNumber(entry.spend);
            dayCount += 1;
          }
        }

        if (dayCount > 0) {
          paceOrders /= dayCount;
          paceRevenue /= dayCount;
          paceSpend /= dayCount;
        }

        activeTotals = {
          orders: totals.orders + paceOrders * remainingDays,
          revenue: totals.revenue + paceRevenue * remainingDays,
          spend: totals.spend + paceSpend * remainingDays
        };
      }
    }

    const prevTotals = monthlyTotalsMap.get(prevKey) || emptyTotals;

    return {
      prefix: monthPrefix,
      prevLabel,
      activeTotals,
      prevTotals,
      hasData: true,
      bounds
    };
  }, [monthHistoryDailyMap, monthHistoryError, monthHistoryLoading, monthHistoryTrends, monthMode, selectedMonthKey, monthlyTotalsMap]);

  const kpis = [
    { key: 'revenue', label: 'Revenue', value: overview.revenue, change: overview.revenueChange, format: 'currency', color: '#8b5cf6' },
    { key: 'spend', label: 'Ad Spend', value: overview.spend, change: overview.spendChange, format: 'currency', color: '#6366f1' },
    { key: 'orders', label: 'Orders', value: overview.orders, change: overview.ordersChange, format: 'number', color: '#22c55e' },
    { key: 'aov', label: 'AOV', value: overview.aov, change: overview.aovChange, format: 'currency', color: '#f59e0b' },
    { key: 'cac', label: 'CAC', value: overview.cac, change: overview.cacChange, format: 'currency', color: '#ef4444' },
    { key: 'roas', label: 'ROAS', value: overview.roas, change: overview.roasChange, format: 'roas', color: '#10b981' },
  ];

  const kpiMonthSummaries = useMemo(() => {
    if (!monthContext) return [];

    if (!monthContext.hasData) {
      return kpis.map((kpi) => ({
        key: kpi.key,
        text: `${monthContext.prefix}: — · — vs ${monthContext.prevLabel}`,
        tone: 'neutral',
        isCelebrating: false
      }));
    }

    const getDeltaPct = (metricKey) => {
      const current = getMetricValue(monthContext.activeTotals, metricKey);
      const previous = getMetricValue(monthContext.prevTotals, metricKey);
      if (previous <= 0) return null;
      return ((current - previous) / previous) * 100;
    };

    const revenueDelta = getDeltaPct('revenue');
    const roasDelta = getDeltaPct('roas');

    return kpis.map((kpi) => {
      const value = getMetricValue(monthContext.activeTotals, kpi.key);
      const deltaPct = getDeltaPct(kpi.key);
      const formattedDelta = deltaPct == null
        ? '—'
        : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(0)}%`;
      const formattedValue = formatMetricValue(kpi.key, value);

      let text = `${monthContext.prefix}: ${formattedValue} · ${formattedDelta} vs ${monthContext.prevLabel}`;

      const historyValues = monthlyTotals
        .filter((item) => item.monthKey !== selectedMonthKey)
        .map((item) => getMetricValue(item, kpi.key))
        .filter((val) => Number.isFinite(val) && val > 0);

      const maxValue = historyValues.length ? Math.max(...historyValues) : null;
      const minValue = historyValues.length ? Math.min(...historyValues) : null;
      const isAllTimeHigh = maxValue != null && value >= maxValue;
      const isAllTimeLow = minValue != null && value <= minValue;

      if (isAllTimeHigh) {
        text += ' · All-time high';
      } else if (isAllTimeLow) {
        text += ' · All-time low';
      }

      const isStrongUplift = deltaPct != null && deltaPct >= 15;
      const isCelebrating = isStrongUplift || isAllTimeHigh;

      let tone = 'neutral';
      if (deltaPct != null) {
        if (kpi.key === 'cac') {
          tone = deltaPct < 0 ? 'positive' : (deltaPct > 0 ? 'negative' : 'neutral');
        } else if (kpi.key === 'spend') {
          const revenueSignal = revenueDelta == null ? 0 : Math.sign(revenueDelta);
          const roasSignal = roasDelta == null ? 0 : Math.sign(roasDelta);
          const performanceSignal = revenueSignal + roasSignal;
          if (performanceSignal > 0) tone = 'positive';
          else if (performanceSignal < 0) tone = 'negative';
          else tone = 'neutral';
        } else {
          tone = deltaPct > 0 ? 'positive' : (deltaPct < 0 ? 'negative' : 'neutral');
        }
      }

      return { key: kpi.key, text, tone, isCelebrating };
    });
  }, [formatMetricValue, getMetricValue, kpis, monthContext, monthlyTotals, selectedMonthKey]);

  const getCampaignEmoji = (name = '') => {
    const n = name.toLowerCase();
    if (n.includes('shawq winter')) return '❄️';
    if (n.includes('shawq uk')) return '🇬🇧';
    if (n.includes('shawq eu')) return '🇪🇺';
    if (n.includes('white friday')) return '🤍';
    if (n.includes('remarket') || n.includes('retarget')) return '🎯';
    if (n.includes('prospect') || n.includes('cold')) return '🚀';
    if (n.includes('brand')) return '🌟';
    if (n.includes('sale') || n.includes('discount')) return '🏷️';
    if (n.includes('test')) return '🧪';
    if (n.includes('video')) return '🎥';
    return '📣';
  };

  const isActiveStatus = (status) => {
    if (!status) return true;
    const normalized = String(status).toUpperCase();
    return normalized === 'ACTIVE' || normalized === 'UNKNOWN';
  };

  const creativeCampaignOptions = useMemo(() => {
    if (!Array.isArray(metaAdManagerData)) return [];
    const options = metaAdManagerData
      .map(campaign => {
        const id = campaign.campaign_id || campaign.campaignId;
        const name = campaign.campaign_name || campaign.campaignName || campaign.name;
        const ads = (campaign.adsets || []).flatMap(adset => adset?.ads || []);
        return { id, name, ads };
      })
      .filter(c => c.id && c.name && Array.isArray(c.ads) && c.ads.length > 0);

    if (options.length === 0) return [];

    const allAds = options.flatMap(c => c.ads);
    const allOption = { id: ALL_CAMPAIGNS_ID, name: 'All Campaigns', ads: allAds, isAggregate: true };
    return [allOption, ...options];
  }, [metaAdManagerData]);

  useEffect(() => {
    if (creativeCampaignOptions.length === 0) {
      if (selectedCreativeCampaignId !== null) {
        setSelectedCreativeCampaignId(null);
      }
      return;
    }
    const exists = creativeCampaignOptions.some(c => c.id === selectedCreativeCampaignId);
    if (!exists) {
      setSelectedCreativeCampaignId(creativeCampaignOptions[0].id);
    }
  }, [creativeCampaignOptions, selectedCreativeCampaignId]);

  const selectedCreativeCampaign = useMemo(() => {
    if (creativeCampaignOptions.length === 0) return null;
    return creativeCampaignOptions.find(c => c.id === selectedCreativeCampaignId) || creativeCampaignOptions[0];
  }, [creativeCampaignOptions, selectedCreativeCampaignId]);

  const ctrCampaignId = selectedCreativeCampaignId === ALL_CAMPAIGNS_ID
    ? null
    : selectedCreativeCampaignId;

  const ctrCountryOptions = useMemo(() => {
    const base = Array.isArray(availableCountries) && availableCountries.length > 0
      ? availableCountries
      : (Array.isArray(dashboard?.countries)
        ? dashboard.countries.map(c => ({
          code: c.code || c.country || c.name || '',
          name: c.name || c.country || c.code || '',
          flag: c.flag || ''
        }))
        : []);

    const unique = new Map();
    base.forEach((country) => {
      const rawCode = (country.code || country.country || '').toUpperCase().trim();
      if (!rawCode) return;
      unique.set(rawCode, {
        code: rawCode,
        name: country.name || country.country || rawCode,
        flag: country.flag || ''
      });
    });

    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [availableCountries, dashboard?.countries]);

  const ctrAdOptions = useMemo(() => {
    if (!selectedCreativeCampaign) return [];
    const ads = Array.isArray(selectedCreativeCampaign.ads) ? selectedCreativeCampaign.ads : [];
    const map = new Map();

    ads.forEach((ad) => {
      const id = ad.ad_id || ad.id;
      if (!id) return;
      const status = ad.ad_effective_status || ad.effective_status || ad.status || ad.ad_status;
      if (!ctrTrendIncludeInactive && !isActiveStatus(status)) return;
      const name = ad.ad_name || ad.name || 'Ad';
      const campaignLabel = selectedCreativeCampaign.isAggregate
        ? (ad.campaign_name || ad.campaignName || selectedCreativeCampaign.name)
        : selectedCreativeCampaign.name;
      const label = selectedCreativeCampaign.isAggregate
        ? `${name} • ${campaignLabel || 'Campaign'}`
        : name;
      map.set(id, {
        id,
        name,
        label,
        campaignName: campaignLabel || null,
        status
      });
    });

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [ctrTrendIncludeInactive, isActiveStatus, selectedCreativeCampaign]);

  useEffect(() => {
    if (ctrTrendAdId !== 'ALL' && !ctrAdOptions.some(option => option.id === ctrTrendAdId)) {
      setCtrTrendAdId('ALL');
    }
  }, [ctrAdOptions, ctrTrendAdId]);

  useEffect(() => {
    if (ctrTrendCountry !== 'ALL' && !ctrCountryOptions.some(option => option.code === ctrTrendCountry)) {
      setCtrTrendCountry('ALL');
    }
  }, [ctrCountryOptions, ctrTrendCountry]);

  const ctrTrendMode = useMemo(() => {
    const hasAd = ctrTrendAdId && ctrTrendAdId !== 'ALL';
    const hasCountry = ctrTrendCountry && ctrTrendCountry !== 'ALL';
    if (hasAd) return hasCountry ? 'ad_country' : 'ad';
    if (hasCountry) return 'country';
    return 'campaign';
  }, [ctrTrendAdId, ctrTrendCountry]);

  const ctrCompareOptions = useMemo(() => {
    if (ctrTrendMode === 'country') {
      return ctrCountryOptions.map(country => ({
        id: country.code,
        label: `${country.flag ? `${country.flag} ` : ''}${country.name} (${country.code})`
      }));
    }
    if (ctrTrendMode === 'ad' || ctrTrendMode === 'ad_country') {
      return ctrAdOptions.map(ad => ({ id: ad.id, label: ad.label }));
    }
    return [];
  }, [ctrAdOptions, ctrCountryOptions, ctrTrendMode]);

  const ctrTrendDefaultCompareIds = useMemo(() => {
    if (ctrTrendMode === 'country' && ctrTrendCountry !== 'ALL') return [ctrTrendCountry];
    if ((ctrTrendMode === 'ad' || ctrTrendMode === 'ad_country') && ctrTrendAdId !== 'ALL') return [ctrTrendAdId];
    return [];
  }, [ctrTrendAdId, ctrTrendCountry, ctrTrendMode]);

  const ctrTrendEffectiveCompareIds = useMemo(() => {
    const validIds = new Set(ctrCompareOptions.map(option => option.id));
    const manual = Array.isArray(ctrTrendCompareIds)
      ? ctrTrendCompareIds.filter(id => validIds.has(id)).slice(0, CTR_COMPARE_LIMIT)
      : null;

    if (manual && manual.length > 0) return manual;
    return ctrTrendDefaultCompareIds.filter(id => validIds.has(id)).slice(0, CTR_COMPARE_LIMIT);
  }, [ctrCompareOptions, ctrTrendCompareIds, ctrTrendDefaultCompareIds]);

  // Used for effects; avoids re-fetching when ids are equal but array refs differ.
  const ctrTrendEffectiveCompareKey = useMemo(() => (
    JSON.stringify(ctrTrendEffectiveCompareIds)
  ), [ctrTrendEffectiveCompareIds]);

  useEffect(() => {
    if (dateRange?.startDate && dateRange?.endDate) {
      setCreativeSummaryRange({ type: 'custom', start: dateRange.startDate, end: dateRange.endDate });
      setCreativeSummaryCustomRange({ start: dateRange.startDate, end: dateRange.endDate });
    }
  }, [dateRange?.startDate, dateRange?.endDate]);

  useEffect(() => {
    if (ctrTrendRangeMode !== 'dashboard') return;
    if (dateRange?.startDate && dateRange?.endDate) {
      setCtrTrendCustomRange({ start: dateRange.startDate, end: dateRange.endDate });
    }
  }, [ctrTrendRangeMode, dateRange?.startDate, dateRange?.endDate]);

  useEffect(() => {
    if (creativeSummaryRange?.type === 'days' && creativeSummaryRange?.value === 1) {
      const interval = setInterval(() => {
        setCreativeSummaryRefreshTick(prev => prev + 1);
      }, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [creativeSummaryRange?.type, creativeSummaryRange?.value]);

  const resolveCreativeSummaryRange = useCallback((range) => {
    if (!range) return null;
    if (range.type === 'custom') {
      if (!range.start || !range.end) return null;
      return { startDate: range.start, endDate: range.end };
    }
    if (range.type === 'yesterday') {
      const yesterday = getIstanbulDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
      return { startDate: yesterday, endDate: yesterday };
    }
    const totalDays = Math.max(1, Number(range.value) || 1);
    const endDate = getIstanbulDateString();
    const startDate = getIstanbulDateString(new Date(Date.now() - (totalDays - 1) * 24 * 60 * 60 * 1000));
    return { startDate, endDate };
  }, []);

  const ctrResolvedRange = useMemo(() => {
    if (ctrTrendRangeMode === 'dashboard' && dateRange?.startDate && dateRange?.endDate) {
      return { startDate: dateRange.startDate, endDate: dateRange.endDate };
    }
    return resolveCreativeSummaryRange(ctrTrendRange);
  }, [ctrTrendRangeMode, dateRange?.startDate, dateRange?.endDate, resolveCreativeSummaryRange, ctrTrendRange]);

  const getPreviousCreativeSummaryRange = useCallback((startDate, endDate) => {
    if (!startDate || !endDate) return null;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const prevStart = new Date(prevEnd.getTime() - (diffDays - 1) * 24 * 60 * 60 * 1000);
    return {
      startDate: getIstanbulDateString(prevStart),
      endDate: getIstanbulDateString(prevEnd)
    };
  }, []);

  const readSsePayload = useCallback(async (response, onDelta) => {
    if (!response?.body) {
      throw new Error('No response body');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let donePayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        try {
          const data = JSON.parse(raw);
          if (data.type === 'delta') {
            onDelta?.(data.text || '');
          } else if (data.type === 'done') {
            donePayload = data;
          } else if (data.type === 'error') {
            throw new Error(data.error || 'Unknown error');
          }
        } catch (error) {
          if (error?.message) {
            throw error;
          }
        }
      }
    }

    return donePayload;
  }, []);

  useEffect(() => {
    if (!store?.id) return;
    const resolvedRange = resolveCreativeSummaryRange(creativeSummaryRange);
    if (!resolvedRange?.startDate || !resolvedRange?.endDate) return;
    const previousRange = getPreviousCreativeSummaryRange(resolvedRange.startDate, resolvedRange.endDate);
    if (!previousRange?.startDate || !previousRange?.endDate) return;

    const params = new URLSearchParams({
      store: store.id,
      startDate: resolvedRange.startDate,
      endDate: resolvedRange.endDate
    });
    const previousParams = new URLSearchParams({
      store: store.id,
      startDate: previousRange.startDate,
      endDate: previousRange.endDate
    });

    if (includeInactive) {
      params.set('includeInactive', 'true');
      previousParams.set('includeInactive', 'true');
    }

    let isActive = true;
    setCreativeSummaryLoading(true);

    Promise.all([
      fetchJson(`${API_BASE}/analytics/meta-ad-manager?${params}`, []),
      fetchJson(`${API_BASE}/analytics/meta-ad-manager?${previousParams}`, [])
    ])
      .then(([currentData, previousData]) => {
        if (!isActive) return;
        const normalize = (data) => (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
        setCreativeSummaryData(normalize(currentData));
        setCreativeSummaryPreviousData(normalize(previousData));
      })
      .finally(() => {
        if (isActive) {
          setCreativeSummaryLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    store?.id,
    includeInactive,
    creativeSummaryRange,
    resolveCreativeSummaryRange,
    getPreviousCreativeSummaryRange,
    creativeSummaryRefreshTick
  ]);

  const fetchCtrSeries = useCallback(async (target, range) => {
    if (!store?.id || !range?.startDate || !range?.endDate) return null;

    const params = new URLSearchParams({
      store: store.id,
      startDate: range.startDate,
      endDate: range.endDate
    });

    if (target.campaignId) params.set('campaignId', target.campaignId);
    if (target.adId) params.set('adId', target.adId);
    if (target.country) params.set('country', target.country);
    if (ctrTrendIncludeInactive) params.set('includeInactive', 'true');

    const data = await fetchJson(`${API_BASE}/analytics/ctr-trends?${params}`, { label: '', series: [] });
    return { ...data, key: target.key };
  }, [ctrTrendIncludeInactive, store?.id]);

  useEffect(() => {
    if (!store?.id) return;
    if (!ctrResolvedRange?.startDate || !ctrResolvedRange?.endDate) return;
    if (!selectedCreativeCampaignId) return;

    const targets = [];
    const campaignId = ctrCampaignId && ctrCampaignId !== ALL_CAMPAIGNS_ID
      ? ctrCampaignId
      : null;

    if (ctrTrendMode === 'campaign') {
      targets.push({ key: campaignId || 'all', campaignId });
    } else if (ctrTrendMode === 'country') {
      ctrTrendEffectiveCompareIds.forEach((code) => {
        targets.push({ key: `country:${code}`, campaignId, country: code });
      });
    } else if (ctrTrendMode === 'ad' || ctrTrendMode === 'ad_country') {
      ctrTrendEffectiveCompareIds.forEach((id) => {
        targets.push({
          key: `ad:${id}:${ctrTrendMode === 'ad_country' ? ctrTrendCountry : 'all'}`,
          campaignId,
          adId: id,
          country: ctrTrendMode === 'ad_country' ? ctrTrendCountry : null
        });
      });
    }

    if (targets.length === 0) {
      setCtrTrendSeries([]);
      return;
    }

    let isActive = true;
    setCtrTrendLoading(true);
    setCtrTrendError('');

    Promise.all(targets.map(target => fetchCtrSeries(target, ctrResolvedRange)))
      .then((results) => {
        if (!isActive) return;
        const cleaned = results.filter(Boolean);
        setCtrTrendSeries(cleaned);
      })
      .catch((error) => {
        if (!isActive) return;
        setCtrTrendSeries([]);
        setCtrTrendError(error?.message || 'Failed to load CTR trends.');
      })
      .finally(() => {
        if (isActive) setCtrTrendLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [
    ctrCampaignId,
    ctrResolvedRange,
    ctrTrendAdId,
    ctrTrendEffectiveCompareKey,
    ctrTrendCountry,
    ctrTrendMode,
    ctrTrendIncludeInactive,
    fetchCtrSeries,
    selectedCreativeCampaignId,
    store?.id
  ]);

  const syncCreativeInsightSettings = useCallback(async ({ action: actionOverride = null, updates = null } = {}) => {
    if (!store?.id) return null;
    const action = actionOverride || (updates ? 'update-settings' : 'get');
    const payload = {
      store: store.id,
      mode: 'creative-funnel-summary',
      action,
      summarySettings: updates || undefined,
      summaryMode: creativeInsightMode
    };

    const response = await fetch(`${API_BASE}/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const donePayload = await readSsePayload(response);
    return donePayload;
  }, [creativeInsightMode, readSsePayload, store?.id]);

  const loadCreativeInsightSummary = useCallback(async () => {
    if (!store?.id) return;
    setCreativeInsightLoading(true);
    setCreativeInsightError('');

    try {
      const payload = await syncCreativeInsightSettings();
      if (payload?.settings) {
        setCreativeInsightAutoEnabled(payload.settings.autoEnabled);
        setCreativeInsightPrompts({
          analyze: payload.settings.analyzePrompt || CREATIVE_FUNNEL_SUMMARY_PROMPTS.analyze,
          summarize: payload.settings.summarizePrompt || CREATIVE_FUNNEL_SUMMARY_PROMPTS.summarize
        });
        setCreativeInsightVerbosity({
          analyze: payload.settings.analyzeVerbosity || 'low',
          summarize: payload.settings.summarizeVerbosity || 'low'
        });
      }
      setCreativeInsightSummary(payload?.summary || null);
    } catch (error) {
      setCreativeInsightError(error.message || 'Failed to load summary.');
    } finally {
      setCreativeInsightLoading(false);
    }
  }, [store?.id, syncCreativeInsightSettings]);

  useEffect(() => {
    loadCreativeInsightSummary();
  }, [creativeInsightMode, loadCreativeInsightSummary]);

  useEffect(() => {
    try {
      localStorage.setItem('creativeInsightLlm', JSON.stringify(creativeInsightLlm));
    } catch (e) {
      // ignore
    }
  }, [creativeInsightLlm]);

  const handleCreativeInsightGenerate = useCallback(async () => {
    if (!store?.id || creativeInsightLoading) return;
    const prompt = creativeInsightPrompts[creativeInsightMode] || '';
    if (!prompt.trim()) {
      setCreativeInsightError('Prompt is required.');
      return;
    }

    const resolvedRange = resolveCreativeSummaryRange(creativeSummaryRange);
    const startDate = resolvedRange?.startDate || null;
    const endDate = resolvedRange?.endDate || null;

    setCreativeInsightLoading(true);
    setCreativeInsightError('');
    setCreativeInsightStreamingText('');
    setCreativeInsightSummary(null);

    try {
      const response = await fetch(`${API_BASE}/ai/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id,
          mode: creativeInsightMode,
          llm: creativeInsightLlm,
          question: prompt.trim(),
          summaryType: 'creative-funnel',
          verbosity: creativeInsightVerbosity[creativeInsightMode] || 'low',
          startDate,
          endDate,
          summarySettings: {
            autoEnabled: creativeInsightAutoEnabled,
            analyzePrompt: creativeInsightPrompts.analyze,
            summarizePrompt: creativeInsightPrompts.summarize,
            analyzeVerbosity: creativeInsightVerbosity.analyze,
            summarizeVerbosity: creativeInsightVerbosity.summarize
          }
        })
      });

      let fullText = '';
      const donePayload = await readSsePayload(response, (delta) => {
        fullText += delta;
        setCreativeInsightStreamingText(fullText);
      });

      setCreativeInsightStreamingText('');
      setCreativeInsightSummary({
        content: fullText,
        model: donePayload?.model || null,
        generated_at: new Date().toISOString(),
        prompt,
        verbosity: creativeInsightVerbosity[creativeInsightMode] || 'low',
        mode: creativeInsightMode
      });
    } catch (error) {
      setCreativeInsightError(error.message || 'Failed to generate summary.');
    } finally {
      setCreativeInsightLoading(false);
    }
  }, [
    creativeInsightAutoEnabled,
    creativeInsightLoading,
    creativeInsightLlm,
    creativeInsightMode,
    creativeInsightPrompts,
    creativeInsightVerbosity,
    creativeSummaryRange,
    readSsePayload,
    resolveCreativeSummaryRange,
    store?.id
  ]);

  const handleCreativeInsightDismiss = useCallback(async () => {
    if (!store?.id) return;
    try {
      await syncCreativeInsightSettings({ action: 'dismiss' });
    } catch (error) {
      setCreativeInsightError(error.message || 'Failed to dismiss summary.');
    } finally {
      setCreativeInsightStreamingText('');
      setCreativeInsightSummary(null);
    }
  }, [store?.id, syncCreativeInsightSettings]);

  const handleCreativeInsightSaveSettings = useCallback(async () => {
    if (!store?.id) return;
    try {
      await syncCreativeInsightSettings({
        updates: {
          autoEnabled: creativeInsightAutoEnabled,
          analyzePrompt: creativeInsightPrompts.analyze,
          summarizePrompt: creativeInsightPrompts.summarize,
          analyzeVerbosity: creativeInsightVerbosity.analyze,
          summarizeVerbosity: creativeInsightVerbosity.summarize
        }
      });
    } catch (error) {
      setCreativeInsightError(error.message || 'Failed to save settings.');
    }
  }, [
    creativeInsightAutoEnabled,
    creativeInsightPrompts,
    creativeInsightVerbosity,
    store?.id,
    syncCreativeInsightSettings
  ]);

  const creativeAds = useMemo(() => {
    if (!selectedCreativeCampaign) return [];
    const ads = Array.isArray(selectedCreativeCampaign.ads) ? selectedCreativeCampaign.ads : [];
    return ads.map((ad, idx) => {
      const purchases = ad.conversions ?? ad.purchases ?? 0;
      const revenue = ad.conversion_value ?? ad.purchase_value ?? ad.revenue ?? 0;
      const impressions = ad.impressions || 0;
      const reach = ad.reach || 0;
      const rawClicks = toNumber(ad.inline_link_clicks ?? ad.link_clicks ?? ad.clicks ?? 0);
      const rawLpv = toNumber(ad.landing_page_views ?? ad.lpv);
      const lpvRatio = toNumber(ad.landing_page_view_per_link_click);
      const lpvFromRatio = lpvRatio > 0 && rawClicks > 0 ? lpvRatio * rawClicks : 0;
      const lpv = rawLpv > 0 ? rawLpv : lpvFromRatio;
      const clicks = rawClicks;
      const outboundClicks = toNumber(ad.outbound_clicks ?? 0);
      const atc = ad.atc ?? ad.add_to_cart ?? 0;
      const checkout = ad.checkout ?? ad.checkouts_initiated ?? 0;
      const spend = ad.spend || 0;
      const aov = purchases > 0 ? revenue / purchases : null;
      const roas = spend > 0 ? revenue / spend : null;
      const countries = Array.isArray(ad.countries) ? ad.countries : [];
      const visits = getVisitsProxy({
        landingPageViews: lpv,
        outboundClicks,
        inlineLinkClicks: clicks
      });
      const safeVisits = Number.isFinite(visits) && visits > 0 ? visits : 0;
      const safePurchases = Number.isFinite(purchases) && purchases > 0 ? purchases : 0;
      const effectivePurchases = Math.min(safePurchases, safeVisits);

      return {
        key: ad.ad_id || ad.id || `creative-${idx}`,
        name: ad.ad_name || ad.name || 'Creative',
        impressions,
        clicks,
        lpv,
        atc,
        checkout,
        purchases,
        aov,
        roas,
        spend,
        revenue,
        reach,
        visits: safeVisits,
        effectivePurchases,
        countries,
        country: ad.country || ad.geo || null
      };
    });
  }, [selectedCreativeCampaign]);

  const toggleCtrCompareId = useCallback((id) => {
    setCtrTrendCompareError('');
    setCtrTrendCompareIds((prev) => {
      const base = Array.isArray(prev) ? prev : ctrTrendEffectiveCompareIds;
      if (base.includes(id)) {
        const next = base.filter(item => item !== id);
        return next.length > 0 ? next : null;
      }
      if (base.length >= CTR_COMPARE_LIMIT) {
        setCtrTrendCompareError(`Select up to ${CTR_COMPARE_LIMIT}.`);
        return prev;
      }
      return [...base, id];
    });
  }, [ctrTrendEffectiveCompareIds]);

  const ctrTrendChartData = useMemo(() => {
    if (!ctrTrendSeries || ctrTrendSeries.length === 0) return [];
    const map = new Map();

    ctrTrendSeries.forEach((series, idx) => {
      const points = Array.isArray(series?.series) ? series.series : [];
      points.forEach(point => {
        if (!point?.date) return;
        const row = map.get(point.date) || { date: point.date };
        row[`series_${idx}`] = point.ctr;
        row[`series_${idx}_clicks`] = point.link_clicks || 0;
        row[`series_${idx}_impressions`] = point.impressions || 0;
        map.set(point.date, row);
      });
    });

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [ctrTrendSeries]);

  const ctrSharpNotes = useMemo(() => {
    if (!ctrTrendSeries || ctrTrendSeries.length === 0) return [];
    const notes = [];

    ctrTrendSeries.forEach((series) => {
      const points = Array.isArray(series?.series) ? series.series : [];
      const valid = points.filter(p => p && Number.isFinite(p.ctr) && (p.impressions || 0) > 0);
      if (valid.length < 6) return;

      const lastSix = valid.slice(-6);
      const prevWindow = lastSix.slice(0, 3);
      const recentWindow = lastSix.slice(3);
      const prevStats = getLinearRegressionStats(prevWindow.map(p => p.ctr));
      const recentStats = getLinearRegressionStats(recentWindow.map(p => p.ctr));
      const slopeChange = recentStats.slope - prevStats.slope;
      const recentImpressions = recentWindow.reduce((sum, p) => sum + (p.impressions || 0), 0);

      if (
        Math.abs(recentStats.slope) < 0.3 ||
        Math.abs(slopeChange) < 0.2 ||
        recentStats.r2 < 0.6 ||
        recentImpressions < 500
      ) {
        return;
      }

      notes.push({
        label: series.label || 'CTR',
        direction: recentStats.slope >= 0 ? 'up' : 'down',
        slope: recentStats.slope,
        startDate: recentWindow[0]?.date,
        r2: recentStats.r2
      });
    });

    return notes;
  }, [ctrTrendSeries]);

  const creativeTotals = useMemo(() => {
    if (creativeAds.length === 0) return null;
    const totals = creativeAds.reduce((acc, row) => ({
      impressions: acc.impressions + (row.impressions || 0),
      clicks: acc.clicks + (row.clicks || 0),
      lpv: acc.lpv + (row.lpv || 0),
      atc: acc.atc + (row.atc || 0),
      purchases: acc.purchases + (row.purchases || 0),
      visits: acc.visits + (row.visits || 0),
      spend: acc.spend + (row.spend || 0),
      revenue: acc.revenue + (row.revenue || 0)
    }), {
      impressions: 0,
      clicks: 0,
      lpv: 0,
      atc: 0,
      purchases: 0,
      visits: 0,
      spend: 0,
      revenue: 0
    });

    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null;
    const atcRate = totals.lpv > 0 ? (totals.atc / totals.lpv) * 100 : null;
    const cvr = totals.visits > 0 ? (totals.purchases / totals.visits) * 100 : null;
    const roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

    return {
      ...totals,
      ctr,
      atcRate,
      cvr,
      roas
    };
  }, [creativeAds]);

  const creativeBaselineCvr = useMemo(() => {
    if (!selectedCreativeCampaign) return EPSILON;
    const ads = Array.isArray(selectedCreativeCampaign.ads) ? selectedCreativeCampaign.ads : [];
    let totalVisits = 0;
    let totalEffectivePurchases = 0;

    ads.forEach((ad) => {
      const purchases = toNumber(ad.conversions ?? ad.purchases ?? 0);
      const lpv = toNumber(ad.landing_page_views ?? ad.lpv ?? 0);
      const outboundClicks = toNumber(ad.outbound_clicks ?? ad.outbound_clicks_click ?? 0);
      const inlineClicks = toNumber(ad.inline_link_clicks ?? ad.link_clicks ?? ad.clicks ?? 0);
      const visits = getVisitsProxy({
        landingPageViews: lpv,
        outboundClicks,
        inlineLinkClicks: inlineClicks
      });
      const effectivePurchases = Math.min(purchases, visits);
      totalVisits += visits;
      totalEffectivePurchases += effectivePurchases;
    });

    const baseline = totalVisits > 0 ? totalEffectivePurchases / totalVisits : 0;
    return Math.max(baseline, EPSILON);
  }, [selectedCreativeCampaign]);

  const creativeRows = useMemo(() => {
    if (creativeAds.length === 0) return [];

    const groups = new Map();

    creativeAds.forEach((ad) => {
      const key = (ad.name || '').trim().toLowerCase() || ad.key;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: ad.name,
          impressions: 0,
          reach: 0,
          clicks: 0,
          lpv: 0,
          atc: 0,
          checkout: 0,
          purchases: 0,
          revenue: 0,
          spend: 0,
          visits: 0,
          effectivePurchases: 0
        });
      }

      const group = groups.get(key);
      group.impressions += ad.impressions || 0;
      group.reach += ad.reach || 0;
      group.clicks += ad.clicks || 0;
      group.lpv += ad.lpv || 0;
      group.atc += ad.atc || 0;
      group.checkout += ad.checkout || 0;
      group.purchases += ad.purchases || 0;
      group.revenue += ad.revenue || 0;
      group.spend += ad.spend || 0;
      group.visits += ad.visits || 0;
      group.effectivePurchases += ad.effectivePurchases || 0;
    });

    const rows = Array.from(groups.values()).map(row => {
      const stats = computeCreativeBayesianStats({
        visits: row.visits,
        effectivePurchases: Math.min(row.effectivePurchases, row.visits),
        baselineCvr: creativeBaselineCvr,
        seedKey: row.key
      });
      const dataStrength = getCreativeDataStrength(row.visits);
      const verdict = getCreativeVerdict({
        visits: row.visits,
        winProb: stats.winProb,
        p10: stats.p10,
        baselineCvr: creativeBaselineCvr
      });

      return {
        ...row,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null,
        atcRate: row.lpv > 0 ? (row.atc / row.lpv) * 100 : null,
        aov: row.purchases > 0 ? row.revenue / row.purchases : null,
        roas: row.spend > 0 ? row.revenue / row.spend : null,
        ...stats,
        dataStrength,
        verdict
      };
    });

    const { field, direction } = creativeSortConfig;
    const dir = direction === 'asc' ? 1 : -1;

    return rows.sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      if (typeof aVal === 'string' || typeof bVal === 'string') {
        return dir * (String(aVal || '').localeCompare(String(bVal || '')));
      }

      const aNum = Number(aVal) || 0;
      const bNum = Number(bVal) || 0;
      return dir * (aNum - bNum);
    });
  }, [creativeAds, creativeSortConfig, creativeBaselineCvr]);

  const creativeCountrySections = useMemo(() => {
    if (creativeAds.length === 0) return [];

    const normalizeCountry = (code) => {
      const cleaned = (code || 'ALL').toString().trim();
      if (!cleaned) return 'ALL';
      return cleaned.toUpperCase();
    };

    const sortRows = (rows) => {
      const { field, direction } = creativeSortConfig;
      const dir = direction === 'asc' ? 1 : -1;

      return [...rows].sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];

        if (typeof aVal === 'string' || typeof bVal === 'string') {
          return dir * (String(aVal || '').localeCompare(String(bVal || '')));
        }

        const aNum = Number(aVal) || 0;
        const bNum = Number(bVal) || 0;
        return dir * (aNum - bNum);
      });
    };

    const countryMap = new Map();

    creativeAds.forEach((ad) => {
      const breakdowns = Array.isArray(ad.countries) && ad.countries.length > 0
        ? ad.countries
        : [{
            country: ad.country || 'ALL',
            spend: ad.spend || 0,
            impressions: ad.impressions || 0,
            reach: ad.reach || 0,
            clicks: ad.clicks ?? 0,
            lpv: ad.lpv || 0,
            add_to_cart: ad.atc || 0,
            checkout: ad.checkout || 0,
            conversions: ad.purchases || 0,
            conversion_value: ad.revenue || 0
          }];

      breakdowns.forEach((countryEntry, idx) => {
        const code = normalizeCountry(countryEntry.country || countryEntry.countryCode || countryEntry.country_name);
        const flag = countryEntry.countryFlag || countryCodeToFlag(code);
        const name = countryEntry.countryName || code;
        const purchases = countryEntry.conversions ?? countryEntry.purchases ?? 0;
        const revenue = countryEntry.conversion_value ?? countryEntry.purchase_value ?? 0;
        const impressions = countryEntry.impressions || 0;
        const reach = countryEntry.reach || 0;
        const rawClicks = toNumber(countryEntry.inline_link_clicks ?? countryEntry.link_clicks ?? countryEntry.clicks ?? countryEntry.click ?? 0);
        const rawLpv = toNumber(countryEntry.landing_page_views ?? countryEntry.lpv);
        const lpvRatio = toNumber(countryEntry.landing_page_view_per_link_click);
        const lpvFromRatio = lpvRatio > 0 && rawClicks > 0 ? lpvRatio * rawClicks : 0;
        const lpv = rawLpv > 0 ? rawLpv : lpvFromRatio;
        const clicks = rawClicks;
        const outboundClicks = toNumber(countryEntry.outbound_clicks ?? 0);
        const atc = countryEntry.add_to_cart ?? countryEntry.atc ?? 0;
        const checkout = countryEntry.checkout ?? countryEntry.checkouts_initiated ?? 0;
        const spend = countryEntry.spend || 0;
        const aov = purchases > 0 ? revenue / purchases : null;
        const roas = spend > 0 ? revenue / spend : null;
        const visits = getVisitsProxy({
          landingPageViews: lpv,
          outboundClicks,
          inlineLinkClicks: clicks
        });
        const safeVisits = Number.isFinite(visits) && visits > 0 ? visits : 0;
        const safePurchases = Number.isFinite(purchases) && purchases > 0 ? purchases : 0;
        const effectivePurchases = Math.min(safePurchases, safeVisits);

        if (!countryMap.has(code)) {
          countryMap.set(code, { code, flag, name, rows: [] });
        }

        const stats = computeCreativeBayesianStats({
          visits,
          effectivePurchases,
          baselineCvr: creativeBaselineCvr,
          seedKey: `${ad.key}-${code}-${idx}`
        });
        const dataStrength = getCreativeDataStrength(visits);
        const verdict = getCreativeVerdict({
          visits,
          winProb: stats.winProb,
          p10: stats.p10,
          baselineCvr: creativeBaselineCvr
        });

        countryMap.get(code).rows.push({
          key: `${ad.key}-${code}-${idx}`,
          name: ad.name,
          impressions,
          reach,
          clicks,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
          lpv,
          atc,
          atcRate: lpv > 0 ? (atc / lpv) * 100 : null,
          checkout,
          purchases,
          visits: safeVisits,
          effectivePurchases,
          ...stats,
          dataStrength,
          verdict,
          aov,
          roas,
          spend
        });
      });
    });

    const sections = Array.from(countryMap.values()).map(section => {
      const rows = sortRows(section.rows);
      const totalPurchases = rows.reduce((sum, row) => sum + (row.purchases || 0), 0);
      return {
        ...section,
        rows,
        totalPurchases
      };
    });

    return sections.sort((a, b) => (b.totalPurchases || 0) - (a.totalPurchases || 0));
  }, [creativeAds, creativeSortConfig, creativeBaselineCvr]);

  const buildCreativeSummaryRowsFromAds = (ads = []) => {
    if (!Array.isArray(ads) || ads.length === 0) return [];
    const groups = new Map();

    ads.forEach((ad, idx) => {
      const name = ad.ad_name || ad.name || 'Creative';
      const key = (name || '').trim().toLowerCase() || ad.ad_id || ad.id || `creative-${idx}`;
      const purchases = ad.conversions ?? ad.purchases ?? 0;
      const revenue = ad.conversion_value ?? ad.purchase_value ?? ad.revenue ?? 0;
      const impressions = ad.impressions || 0;
      const reach = ad.reach || 0;
      const rawClicks = toNumber(ad.inline_link_clicks ?? ad.link_clicks ?? ad.clicks ?? 0);
      const rawLpv = toNumber(ad.landing_page_views ?? ad.lpv);
      const lpvRatio = toNumber(ad.landing_page_view_per_link_click);
      const lpvFromRatio = lpvRatio > 0 && rawClicks > 0 ? lpvRatio * rawClicks : 0;
      const lpv = rawLpv > 0 ? rawLpv : lpvFromRatio;
      const clicks = rawClicks;
      const outboundClicks = toNumber(ad.outbound_clicks ?? 0);
      const atc = ad.atc ?? ad.add_to_cart ?? 0;
      const checkout = ad.checkout ?? ad.checkouts_initiated ?? 0;
      const spend = ad.spend || 0;
      const visits = getVisitsProxy({
        landingPageViews: lpv,
        outboundClicks,
        inlineLinkClicks: clicks
      });
      const safeVisits = Number.isFinite(visits) && visits > 0 ? visits : 0;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name,
          impressions: 0,
          reach: 0,
          clicks: 0,
          lpv: 0,
          atc: 0,
          checkout: 0,
          purchases: 0,
          revenue: 0,
          spend: 0,
          visits: 0
        });
      }

      const group = groups.get(key);
      group.impressions += impressions;
      group.reach += reach;
      group.clicks += clicks;
      group.lpv += lpv;
      group.atc += atc;
      group.checkout += checkout;
      group.purchases += purchases;
      group.revenue += revenue;
      group.spend += spend;
      group.visits += safeVisits;
    });

    return Array.from(groups.values()).map(row => ({
      ...row,
      ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null,
      frequency: row.reach > 0 ? row.impressions / row.reach : null,
      atcRate: row.lpv > 0 ? (row.atc / row.lpv) * 100 : null,
      checkoutRate: row.atc > 0 ? (row.checkout / row.atc) * 100 : null,
      cvr: row.visits > 0 ? (row.purchases / row.visits) * 100 : null,
      roas: row.spend > 0 ? row.revenue / row.spend : null
    }));
  };

  const creativeSummaryCampaign = useMemo(() => {
    if (selectedCreativeCampaignId === ALL_CAMPAIGNS_ID) return null;
    if (!Array.isArray(creativeSummaryData) || creativeSummaryData.length === 0) return null;
    return creativeSummaryData.find(c => (c.campaign_id || c.campaignId) === selectedCreativeCampaignId)
      || creativeSummaryData[0];
  }, [creativeSummaryData, selectedCreativeCampaignId]);

  const creativeSummaryPreviousCampaign = useMemo(() => {
    if (selectedCreativeCampaignId === ALL_CAMPAIGNS_ID) return null;
    if (!Array.isArray(creativeSummaryPreviousData) || creativeSummaryPreviousData.length === 0) return null;
    return creativeSummaryPreviousData.find(c => (c.campaign_id || c.campaignId) === selectedCreativeCampaignId)
      || creativeSummaryPreviousData[0];
  }, [creativeSummaryPreviousData, selectedCreativeCampaignId]);

  const collectCreativeSummaryAds = useCallback((summaryData = []) => {
    if (!Array.isArray(summaryData)) return [];
    return summaryData.flatMap((campaign) => (
      Array.isArray(campaign?.adsets) ? campaign.adsets.flatMap(adset => adset?.ads || []) : []
    ));
  }, []);

  const creativeSummaryRows = useMemo(() => {
    const ads = selectedCreativeCampaignId === ALL_CAMPAIGNS_ID
      ? collectCreativeSummaryAds(creativeSummaryData)
      : (Array.isArray(creativeSummaryCampaign?.adsets)
        ? creativeSummaryCampaign.adsets.flatMap(adset => adset?.ads || [])
        : []);
    return buildCreativeSummaryRowsFromAds(ads);
  }, [creativeSummaryCampaign, creativeSummaryData, collectCreativeSummaryAds, selectedCreativeCampaignId]);

  const creativeSummaryPreviousRows = useMemo(() => {
    const ads = selectedCreativeCampaignId === ALL_CAMPAIGNS_ID
      ? collectCreativeSummaryAds(creativeSummaryPreviousData)
      : (Array.isArray(creativeSummaryPreviousCampaign?.adsets)
        ? creativeSummaryPreviousCampaign.adsets.flatMap(adset => adset?.ads || [])
        : []);
    return buildCreativeSummaryRowsFromAds(ads);
  }, [creativeSummaryPreviousCampaign, creativeSummaryPreviousData, collectCreativeSummaryAds, selectedCreativeCampaignId]);

  const creativeSummaryTopSpenders = useMemo(() => (
    [...creativeSummaryRows].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5)
  ), [creativeSummaryRows]);

  const creativeSummaryPreviousMap = useMemo(() => (
    new Map(creativeSummaryPreviousRows.map(row => [row.key, row]))
  ), [creativeSummaryPreviousRows]);

  const creativeFunnelSummary = useMemo(() => {
    if (creativeRows.length === 0) return null;

    const totals = creativeRows.reduce((acc, row) => ({
      impressions: acc.impressions + (row.impressions || 0),
      clicks: acc.clicks + (row.clicks || 0),
      lpv: acc.lpv + (row.lpv || 0),
      atc: acc.atc + (row.atc || 0),
      purchases: acc.purchases + (row.purchases || 0),
      visits: acc.visits + (row.visits || 0),
      spend: acc.spend + (row.spend || 0),
      revenue: acc.revenue + (row.revenue || 0)
    }), {
      impressions: 0,
      clicks: 0,
      lpv: 0,
      atc: 0,
      purchases: 0,
      visits: 0,
      spend: 0,
      revenue: 0
    });

    const baseline = {
      ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
      atcRate: totals.lpv > 0 ? (totals.atc / totals.lpv) * 100 : null,
      cvr: totals.visits > 0 ? (totals.purchases / totals.visits) * 100 : null,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : null
    };

    const byPurchases = [...creativeRows].sort((a, b) => (b.purchases || 0) - (a.purchases || 0));
    const leader = byPurchases[0];
    const runnerUp = byPurchases[1] || null;
    const laggard = byPurchases[byPurchases.length - 1];

    const getRowMetrics = (row) => ({
      ctr: row?.ctr ?? null,
      atcRate: row?.atcRate ?? null,
      cvr: row?.visits > 0 ? (row.purchases / row.visits) * 100 : null,
      roas: row?.roas ?? null
    });

    return {
      baseline,
      leader,
      runnerUp,
      laggard,
      leaderMetrics: getRowMetrics(leader),
      laggardMetrics: getRowMetrics(laggard)
    };
  }, [creativeRows, creativeSummaryGeneratedAt]);

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

  // Sort country trends by total orders (descending), with New York first if available
  const orderedCountryTrends = [
    ...(nyTrendData ? [nyTrendData] : []),
    ...countryTrends
  ].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0));
  const orderedCampaignTrends = [...campaignTrends].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0));
  const getCountryTrendRangeLabel = () => {
    if (countryTrendsRangeMode === 'quick') {
      const { type, value } = countryTrendsQuickRange || {};
      if (type === 'weeks' && value) return `Quick range: Last ${value} week${value === 1 ? '' : 's'}`;
      if (type === 'months' && value) return `Quick range: Last ${value} month${value === 1 ? '' : 's'}`;
      if (type === 'yesterday') return 'Quick range: Yesterday';
      if (countryTrendsQuickRange?.start && countryTrendsQuickRange?.end) {
        return `Quick range: ${countryTrendsQuickRange.start} to ${countryTrendsQuickRange.end}`;
      }
      return 'Quick range';
    }
    if (dateRange?.startDate && dateRange?.endDate) {
      return `Using dashboard range (${dateRange.startDate} to ${dateRange.endDate})`;
    }
    return 'Using dashboard date range';
  };
  const getCampaignTrendRangeLabel = () => {
    if (campaignTrendsRangeMode === 'quick') {
      const { type, value } = campaignTrendsQuickRange || {};
      if (type === 'weeks' && value) return `Quick range: Last ${value} week${value === 1 ? '' : 's'}`;
      if (type === 'months' && value) return `Quick range: Last ${value} month${value === 1 ? '' : 's'}`;
      if (type === 'yesterday') return 'Quick range: Yesterday';
      if (campaignTrendsQuickRange?.start && campaignTrendsQuickRange?.end) {
        return `Quick range: ${campaignTrendsQuickRange.start} to ${campaignTrendsQuickRange.end}`;
      }
      return 'Quick range';
    }
    if (dateRange?.startDate && dateRange?.endDate) {
      return `Using dashboard range (${dateRange.startDate} to ${dateRange.endDate})`;
    }
    return 'Using dashboard date range';
  };

  const getBucketDays = (totalDays) => {
    if (totalDays <= 7) return 1;
    if (totalDays <= 21) return 3;
    if (totalDays < 60) return 7;
    return 30;
  };

  const parseLocalDate = useCallback((dateString) => {
    if (!dateString) return null;
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? `${dateString}T00:00:00` : dateString;
    const parsed = new Date(safeDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, []);

  const getPointDate = useCallback((point) => {
    if (!point) return '';
    return point.date || point.day || point.label || '';
  }, []);

  const capitalize = (value = '') => value.charAt(0).toUpperCase() + value.slice(1);




  const getTotalDays = useCallback(() => {
    if (dateRange?.startDate && dateRange?.endDate) {
      const start = parseLocalDate(dateRange.startDate);
      const end = parseLocalDate(dateRange.endDate);
      if (start && end) {
        const diffMs = end.getTime() - start.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
        return Math.max(diffDays, 1);
      }
    }
    if (Array.isArray(trends) && trends.length > 0) {
      return trends.length;
    }
    return 0;
  }, [dateRange, parseLocalDate, trends]);

  const totalDays = getTotalDays();
  const bucketDays = getBucketDays(totalDays);
  const maWindow = totalDays >= 60 ? 30 : 7;
  const isBucketMode = chartMode === 'bucket';

  const aggregateBucket = useCallback((dataPoints = []) => {
    if (!Array.isArray(dataPoints) || dataPoints.length === 0) return null;
    const orders = dataPoints.reduce((sum, point) => sum + toNumber(point.orders), 0);
    const revenue = dataPoints.reduce((sum, point) => sum + toNumber(point.revenue), 0);
    const spend = dataPoints.reduce((sum, point) => sum + toNumber(point.spend), 0);

    return {
      orders,
      revenue,
      spend,
      roas: spend > 0 ? revenue / spend : 0,
      cac: orders > 0 ? spend / orders : 0,
      aov: orders > 0 ? revenue / orders : 0
    };
  }, []);

  const buildBucketedTrends = useCallback((series = []) => {
    if (!Array.isArray(series) || series.length === 0) return [];
    const sorted = [...series]
      .filter(point => getPointDate(point))
      .sort((a, b) => {
        const aDate = parseLocalDate(getPointDate(a));
        const bDate = parseLocalDate(getPointDate(b));
        if (!aDate || !bDate) return 0;
        return aDate.getTime() - bDate.getTime();
      });

    if (bucketDays <= 1) {
      return sorted.map((point) => {
        const orders = toNumber(point.orders);
        const revenue = toNumber(point.revenue);
        const spend = toNumber(point.spend);
        const dateKey = getPointDate(point);
        return {
          ...point,
          orders,
          revenue,
          spend,
          roas: spend > 0 ? revenue / spend : 0,
          cac: orders > 0 ? spend / orders : 0,
          aov: orders > 0 ? revenue / orders : 0,
          bucketStartDate: dateKey,
          bucketEndDate: dateKey,
          bucketExpectedEndDate: dateKey,
          isIncomplete: false
        };
      });
    }

    const buckets = [];
    for (let i = 0; i < sorted.length; i += bucketDays) {
      const chunk = sorted.slice(i, i + bucketDays);
      const summary = aggregateBucket(chunk);
      if (!summary) continue;
      const bucketStartDate = getPointDate(chunk[0]);
      const bucketEndDate = getPointDate(chunk[chunk.length - 1]);
      const bucketStart = parseLocalDate(bucketStartDate);
      let bucketExpectedEndDate = bucketEndDate;
      if (bucketStart) {
        const expectedEnd = new Date(bucketStart);
        expectedEnd.setDate(expectedEnd.getDate() + bucketDays - 1);
        bucketExpectedEndDate = getLocalDateString(expectedEnd);
      }
      buckets.push({
        ...summary,
        date: bucketEndDate,
        bucketStartDate,
        bucketEndDate,
        bucketExpectedEndDate
      });
    }

    return buckets;
  }, [aggregateBucket, bucketDays, getLocalDateString, getPointDate, parseLocalDate]);

  const bucketedTrends = useMemo(() => (
    buildBucketedTrends(trends)
  ), [buildBucketedTrends, trends]);

  const dailyTrendMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(trends) ? trends : []).forEach((point) => {
      const dateKey = getPointDate(point);
      if (!dateKey) return;
      map.set(dateKey, {
        orders: toNumber(point.orders),
        revenue: toNumber(point.revenue),
        spend: toNumber(point.spend)
      });
    });
    return map;
  }, [getPointDate, trends]);

  const buildBucketedTrendsWithStatus = useCallback((series = []) => {
    if (series.length === 0) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return series.map((point, index) => {
      const isLast = index === series.length - 1;
      const bucketEnd = parseLocalDate(point.bucketExpectedEndDate || point.bucketEndDate);
      const isIncomplete = isLast && bucketEnd && bucketEnd >= today;
      const bucketExpectedEndDate = isIncomplete
        ? (point.bucketExpectedEndDate || point.bucketEndDate)
        : point.bucketEndDate;
      return { ...point, isIncomplete, bucketExpectedEndDate };
    });
  }, [parseLocalDate]);

  const bucketedTrendsWithStatus = useMemo(() => (
    buildBucketedTrendsWithStatus(bucketedTrends)
  ), [buildBucketedTrendsWithStatus, bucketedTrends]);

  const buildBucketedTrendsForChart = useCallback((series = [], dailyMap = new Map()) => {
    const keys = ['orders', 'revenue', 'spend', 'aov', 'cac', 'roas'];
    if (series.length === 0) {
      return { data: [], lastBucketIncomplete: false, hasProjection: false };
    }

    const todayLocalString = getLocalDateString(new Date());
    const today = parseLocalDate(todayLocalString);
    if (!today) {
      return { data: [], lastBucketIncomplete: false, hasProjection: false };
    }

    const lastIndex = series.length - 1;
    const lastPoint = series[lastIndex];
    const lastBucketIncomplete = lastPoint.isIncomplete;
    const bucketExpectedEnd = lastPoint.bucketExpectedEndDate || lastPoint.bucketEndDate;

    let hasProjection = false;
    let projectionSourceIndex = null;
    let projectedTotals = null;

    const msInDay = 1000 * 60 * 60 * 24;

    const getWeightedPace = () => {
      // Simple: average of last 7 days (or available days)
      let totalOrders = 0, totalRevenue = 0, totalSpend = 0;
      let dayCount = 0;

      for (let offset = 1; offset <= 7; offset += 1) {
        const day = new Date(today);
        day.setDate(day.getDate() - offset);
        const dayKey = getLocalDateString(day);
        const entry = dailyMap?.get(dayKey);
        if (entry) {
          totalOrders += toNumber(entry.orders);
          totalRevenue += toNumber(entry.revenue);
          totalSpend += toNumber(entry.spend);
          dayCount += 1;
        }
      }

      if (dayCount === 0) {
        // Fallback: use bucket data / elapsed days
        const elapsedDays = Math.floor((today - parseLocalDate(lastPoint.bucketStartDate)) / (1000 * 60 * 60 * 24)) + 1;
        const safeElapsed = Math.max(elapsedDays, 1);
        return {
          orders: toNumber(lastPoint.orders) / safeElapsed,
          revenue: toNumber(lastPoint.revenue) / safeElapsed,
          spend: toNumber(lastPoint.spend) / safeElapsed
        };
      }

      return {
        orders: totalOrders / dayCount,
        revenue: totalRevenue / dayCount,
        spend: totalSpend / dayCount
      };
    };
    
    if (lastBucketIncomplete && bucketExpectedEnd && lastIndex > 0) {
      const bucketStart = parseLocalDate(lastPoint.bucketStartDate);
      const bucketEnd = parseLocalDate(bucketExpectedEnd);
      if (bucketStart && bucketEnd) {
        const elapsedDays = Math.floor((today - bucketStart) / msInDay) + 1;
        const totalDays = Math.floor((bucketEnd - bucketStart) / msInDay) + 1;
        const remainingDays = Math.max(totalDays - elapsedDays, 0);

        if (elapsedDays >= 2 && remainingDays > 0) {
          let pace = getWeightedPace();
          const safeElapsed = Math.max(elapsedDays, 1);
          if (!pace.orders) {
            pace.orders = toNumber(lastPoint.orders) / safeElapsed;
          }
          if (!pace.revenue) {
            pace.revenue = toNumber(lastPoint.revenue) / safeElapsed;
          }
          if (!pace.spend) {
            pace.spend = toNumber(lastPoint.spend) / safeElapsed;
          }

          const projectedOrders = toNumber(lastPoint.orders) + pace.orders * remainingDays;
          const projectedRevenue = toNumber(lastPoint.revenue) + pace.revenue * remainingDays;
          const projectedSpend = toNumber(lastPoint.spend) + pace.spend * remainingDays;

          const projectedAov = projectedOrders > 0 ? projectedRevenue / projectedOrders : 0;
          const projectedCac = projectedOrders > 0 ? projectedSpend / projectedOrders : 0;
          const projectedRoas = projectedSpend > 0 ? projectedRevenue / projectedSpend : 0;

          projectedTotals = {
            ordersProjected: projectedOrders,
            revenueProjected: projectedRevenue,
            spendProjected: projectedSpend,
            aovProjected: projectedAov,
            cacProjected: projectedCac,
            roasProjected: projectedRoas
          };

          projectionSourceIndex = lastIndex - 1;
          hasProjection = true;
        }
      }
    }

    const showIncompleteLine = lastBucketIncomplete && !hasProjection;

    const data = series.map((point, index) => {
      const isLast = index === lastIndex;
      const isPrev = index === lastIndex - 1;
      const next = { ...point };
      next.date = point.bucketExpectedEndDate || point.bucketEndDate || point.date;

      keys.forEach((key) => {
        const value = toNumber(point[key]);
        next[`${key}Complete`] = !lastBucketIncomplete || !isLast ? value : null;
        const showIncomplete = lastBucketIncomplete && (isLast || (showIncompleteLine && isPrev));
        next[`${key}Incomplete`] = showIncomplete ? value : null;
      });
      return next;
    });

    if (hasProjection && projectionSourceIndex != null && projectedTotals) {
      const sourcePoint = data[projectionSourceIndex];
      keys.forEach((key) => {
        sourcePoint[`${key}Projected`] = toNumber(series[projectionSourceIndex]?.[key]);
      });
      const targetPoint = data[lastIndex];
      Object.entries(projectedTotals).forEach(([key, value]) => {
        targetPoint[key] = value;
      });
    }

    return { data, lastBucketIncomplete, hasProjection };
  }, [getLocalDateString, parseLocalDate]);
  const {
    data: bucketedTrendsForChart,
    lastBucketIncomplete,
    hasProjection: bucketHasProjection
  } = useMemo(() => (
    buildBucketedTrendsForChart(bucketedTrendsWithStatus, dailyTrendMap)
  ), [buildBucketedTrendsForChart, bucketedTrendsWithStatus, dailyTrendMap]);

  const regionCompareDateOrder = useMemo(() => {
    if (!Array.isArray(trends) || trends.length === 0) return [];
    const seen = new Set();
    return trends
      .map((point) => getPointDate(point))
      .filter((date) => {
        if (!date || seen.has(date)) return false;
        seen.add(date);
        return true;
      });
  }, [getPointDate, trends]);

  const getCountryCode = useCallback((country = {}) => {
    const rawCode = country.countryCode || country.code || country.country_code || country.countryIso;
    return rawCode ? String(rawCode).toUpperCase() : '';
  }, []);

  const buildRegionTrendSeries = useCallback((countryCodes = new Set()) => {
    if (!Array.isArray(regionCompareTrends) || regionCompareTrends.length === 0) return [];
    const byDate = new Map();

    regionCompareTrends.forEach((country) => {
      const code = getCountryCode(country);
      if (!code || !countryCodes.has(code)) return;
      const points = Array.isArray(country?.trends) ? country.trends : [];
      points.forEach((point) => {
        const date = getPointDate(point);
        if (!date) return;
        const entry = byDate.get(date) || { date, orders: 0, revenue: 0, spend: 0 };
        entry.orders += toNumber(point.orders);
        entry.revenue += toNumber(point.revenue);
        entry.spend += toNumber(point.spend);
        byDate.set(date, entry);
      });
    });

    const orderedDates = regionCompareDateOrder.length > 0
      ? regionCompareDateOrder
      : Array.from(byDate.keys()).sort((a, b) => {
        const aDate = parseLocalDate(a);
        const bDate = parseLocalDate(b);
        if (!aDate || !bDate) return 0;
        return aDate.getTime() - bDate.getTime();
      });

    return orderedDates.map((date) => (
      byDate.get(date) || { date, orders: 0, revenue: 0, spend: 0 }
    ));
  }, [getCountryCode, getPointDate, parseLocalDate, regionCompareDateOrder, regionCompareTrends]);

  const europeRegionTrends = useMemo(() => (
    buildRegionTrendSeries(EUROPE_COUNTRY_CODES)
  ), [buildRegionTrendSeries]);

  const usaRegionTrends = useMemo(() => (
    buildRegionTrendSeries(USA_COUNTRY_CODES)
  ), [buildRegionTrendSeries]);

  const europeDailyTrendMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(europeRegionTrends) ? europeRegionTrends : []).forEach((point) => {
      const dateKey = getPointDate(point);
      if (!dateKey) return;
      map.set(dateKey, {
        orders: toNumber(point.orders),
        revenue: toNumber(point.revenue),
        spend: toNumber(point.spend)
      });
    });
    return map;
  }, [europeRegionTrends, getPointDate]);

  const usaDailyTrendMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(usaRegionTrends) ? usaRegionTrends : []).forEach((point) => {
      const dateKey = getPointDate(point);
      if (!dateKey) return;
      map.set(dateKey, {
        orders: toNumber(point.orders),
        revenue: toNumber(point.revenue),
        spend: toNumber(point.spend)
      });
    });
    return map;
  }, [getPointDate, usaRegionTrends]);

  const europeBucketedTrends = useMemo(() => (
    buildBucketedTrends(europeRegionTrends)
  ), [buildBucketedTrends, europeRegionTrends]);
  const usaBucketedTrends = useMemo(() => (
    buildBucketedTrends(usaRegionTrends)
  ), [buildBucketedTrends, usaRegionTrends]);

  const europeBucketedWithStatus = useMemo(() => (
    buildBucketedTrendsWithStatus(europeBucketedTrends)
  ), [buildBucketedTrendsWithStatus, europeBucketedTrends]);
  const usaBucketedWithStatus = useMemo(() => (
    buildBucketedTrendsWithStatus(usaBucketedTrends)
  ), [buildBucketedTrendsWithStatus, usaBucketedTrends]);

  const {
    data: europeBucketedForChart,
    lastBucketIncomplete: europeLastBucketIncomplete,
    hasProjection: europeHasProjection
  } = useMemo(() => (
    buildBucketedTrendsForChart(europeBucketedWithStatus, europeDailyTrendMap)
  ), [buildBucketedTrendsForChart, europeBucketedWithStatus, europeDailyTrendMap]);

  const {
    data: usaBucketedForChart,
    lastBucketIncomplete: usaLastBucketIncomplete,
    hasProjection: usaHasProjection
  } = useMemo(() => (
    buildBucketedTrendsForChart(usaBucketedWithStatus, usaDailyTrendMap)
  ), [buildBucketedTrendsForChart, usaBucketedWithStatus, usaDailyTrendMap]);

  const prefixBucketedSeries = useCallback((series = [], prefix = '') => {
    const metricKeys = ['orders', 'revenue', 'spend', 'aov', 'cac', 'roas'];
    const normalizePrefix = prefix ? `${prefix}` : '';
      return series.map((point) => {
      const next = {
        date: point.date,
        bucketStartDate: point.bucketStartDate,
        bucketEndDate: point.bucketEndDate,
        bucketExpectedEndDate: point.bucketExpectedEndDate,
        [`${normalizePrefix}IsIncomplete`]: point.isIncomplete
      };
      metricKeys.forEach((metric) => {
        const capMetric = capitalize(metric);
        next[`${normalizePrefix}${capMetric}Complete`] = point[`${metric}Complete`];
        next[`${normalizePrefix}${capMetric}Incomplete`] = point[`${metric}Incomplete`];
        next[`${normalizePrefix}${capMetric}Projected`] = point[`${metric}Projected`];
      });
      return next;
    });
  }, []);

  const regionCompareBucketChartData = useMemo(() => {
    const europeSeries = prefixBucketedSeries(europeBucketedForChart, 'europe');
    const usaSeries = prefixBucketedSeries(usaBucketedForChart, 'usa');
    const byDate = new Map();
    const mergePoint = (point) => {
      if (!point?.date) return;
      const existing = byDate.get(point.date) || { date: point.date };
      if (point.bucketStartDate && !existing.bucketStartDate) {
        existing.bucketStartDate = point.bucketStartDate;
      }
      if (point.bucketEndDate && !existing.bucketEndDate) {
        existing.bucketEndDate = point.bucketEndDate;
      }
      if (point.bucketExpectedEndDate && !existing.bucketExpectedEndDate) {
        existing.bucketExpectedEndDate = point.bucketExpectedEndDate;
      }
      Object.entries(point).forEach(([key, value]) => {
        if (key === 'date' || key === 'bucketStartDate' || key === 'bucketEndDate' || key === 'bucketExpectedEndDate') return;
        existing[key] = value;
      });
      byDate.set(point.date, existing);
    };
    europeSeries.forEach(mergePoint);
    usaSeries.forEach(mergePoint);
    return Array.from(byDate.values()).sort((a, b) => {
      const aDate = parseLocalDate(a.date);
      const bDate = parseLocalDate(b.date);
      if (!aDate || !bDate) return 0;
      return aDate.getTime() - bDate.getTime();
    });
  }, [europeBucketedForChart, parseLocalDate, prefixBucketedSeries, usaBucketedForChart]);

  const buildMovingAverageSeries = useCallback((series = [], windowSize = 7) => {
    const cleaned = (Array.isArray(series) ? series : [])
      .map((point) => {
        const date = getPointDate(point);
        if (!date) return null;
        const orders = toNumber(point?.orders);
        const revenue = toNumber(point?.revenue);
        const spend = toNumber(point?.spend);
        return { date, orders, revenue, spend };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aDate = parseLocalDate(a.date);
        const bDate = parseLocalDate(b.date);
        if (!aDate || !bDate) return 0;
        return aDate.getTime() - bDate.getTime();
      });

    if (cleaned.length === 0) return [];

    const ordersValues = cleaned.map((point) => point.orders || 0);
    const revenueValues = cleaned.map((point) => point.revenue || 0);
    const spendValues = cleaned.map((point) => point.spend || 0);

    const ordersMA = getMovingAverage(ordersValues, windowSize);
    const revenueMA = getMovingAverage(revenueValues, windowSize);
    const spendMA = getMovingAverage(spendValues, windowSize);

    return cleaned.map((point, index) => {
      const ordersMAValue = toNumber(ordersMA[index]);
      const revenueMAValue = toNumber(revenueMA[index]);
      const spendMAValue = toNumber(spendMA[index]);
      const aov = point.orders > 0 ? point.revenue / point.orders : 0;
      const cac = point.orders > 0 ? point.spend / point.orders : 0;
      const roas = point.spend > 0 ? point.revenue / point.spend : 0;
      return {
        ...point,
        aov,
        cac,
        roas,
        ordersMA: ordersMAValue,
        revenueMA: revenueMAValue,
        spendMA: spendMAValue,
        aovMA: ordersMAValue > 0 ? revenueMAValue / ordersMAValue : 0,
        cacMA: ordersMAValue > 0 ? spendMAValue / ordersMAValue : 0,
        roasMA: spendMAValue > 0 ? revenueMAValue / spendMAValue : 0
      };
    });
  }, [getPointDate, parseLocalDate]);

  const maTrends = useMemo(() => (
    buildMovingAverageSeries(trends, maWindow)
  ), [buildMovingAverageSeries, maWindow, trends]);

  const europeMaTrends = useMemo(() => (
    buildMovingAverageSeries(europeRegionTrends, maWindow)
  ), [buildMovingAverageSeries, europeRegionTrends, maWindow]);

  const usaMaTrends = useMemo(() => (
    buildMovingAverageSeries(usaRegionTrends, maWindow)
  ), [buildMovingAverageSeries, maWindow, usaRegionTrends]);

  const prefixMaSeries = useCallback((series = [], prefix = '') => {
    const metricKeys = ['orders', 'revenue', 'spend', 'aov', 'cac', 'roas'];
    const normalizePrefix = prefix ? `${prefix}` : '';
      return series.map((point) => {
      const next = { date: point.date };
      metricKeys.forEach((metric) => {
        const capMetric = capitalize(metric);
        next[`${normalizePrefix}${capMetric}`] = point[metric];
        next[`${normalizePrefix}${capMetric}MA`] = point[`${metric}MA`];
      });
      return next;
    });
  }, []);

  const regionCompareMaChartData = useMemo(() => {
    const europeSeries = prefixMaSeries(europeMaTrends, 'europe');
    const usaSeries = prefixMaSeries(usaMaTrends, 'usa');
    const byDate = new Map();
    const mergePoint = (point) => {
      if (!point?.date) return;
      const existing = byDate.get(point.date) || { date: point.date };
      Object.entries(point).forEach(([key, value]) => {
        if (key === 'date') return;
        existing[key] = value;
      });
      byDate.set(point.date, existing);
    };
    europeSeries.forEach(mergePoint);
    usaSeries.forEach(mergePoint);
    return Array.from(byDate.values()).sort((a, b) => {
      const aDate = parseLocalDate(a.date);
      const bDate = parseLocalDate(b.date);
      if (!aDate || !bDate) return 0;
      return aDate.getTime() - bDate.getTime();
    });
  }, [europeMaTrends, parseLocalDate, prefixMaSeries, usaMaTrends]);

  const regionCompareActive = regionCompareEnabled && (
    isBucketMode ? regionCompareBucketChartData.length > 0 : regionCompareMaChartData.length > 0
  );
  const regionCompareChartData = isBucketMode ? regionCompareBucketChartData : regionCompareMaChartData;
  const hasTrendData = isBucketMode
    ? bucketedTrendsWithStatus.length > 0
    : maTrends.length > 0;

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

  // Build smoothed series plus trend signal metadata for analytics charts.
  const buildTrendAnalytics = useCallback((rawSeries = []) => {
    const cleaned = (Array.isArray(rawSeries) ? rawSeries : [])
      .map((point) => ({
        date: getPointDate(point),
        orders: toNumber(point?.orders),
        revenue: toNumber(point?.revenue)
      }))
      .filter((point) => point.date)
      .sort((a, b) => {
        const aDate = parseLocalDate(a.date);
        const bDate = parseLocalDate(b.date);
        if (!aDate || !bDate) return 0;
        return aDate.getTime() - bDate.getTime();
      });

    if (cleaned.length === 0) {
      return { series: [], meta: null };
    }

    const ordersValues = cleaned.map((point) => point.orders || 0);
    const revenueValues = cleaned.map((point) => point.revenue || 0);
    const window = Math.min(7, cleaned.length);
    const ordersMA = getMovingAverage(ordersValues, window);
    const revenueMA = getMovingAverage(revenueValues, window);

    const recent = ordersValues.slice(-window);
    const previous = ordersValues.slice(-window * 2, -window);
    const recentSum = recent.reduce((sum, value) => sum + value, 0);
    const prevSum = previous.reduce((sum, value) => sum + value, 0);
    const changePct = prevSum > 0 ? (recentSum - prevSum) / prevSum : null;

    const { slope, r2 } = getLinearRegressionStats(ordersValues);
    const meanOrders = getMean(ordersValues);
    const volatility = meanOrders > 0 ? getStandardDeviation(ordersValues, meanOrders) / meanOrders : null;

    return {
      series: cleaned.map((point, index) => ({
        ...point,
        orders: ordersValues[index],
        revenue: revenueValues[index],
        ordersMA: ordersMA[index],
        revenueMA: revenueMA[index]
      })),
      meta: {
        window,
        changePct,
        slope,
        r2,
        volatility,
        lastOrders: ordersValues[ordersValues.length - 1],
        lastRevenue: revenueValues[revenueValues.length - 1]
      }
    };
  }, [getPointDate, parseLocalDate]);

  const annotatedCountryTrends = useMemo(() => (
    orderedCountryTrends
      .map((country) => ({
        ...country,
        analytics: buildTrendAnalytics(country.trends)
      }))
      .filter((country) => country.analytics?.series?.length > 0)
  ), [buildTrendAnalytics, orderedCountryTrends]);

  const annotatedCampaignTrends = useMemo(() => (
    orderedCampaignTrends
      .map((campaign) => ({
        ...campaign,
        analytics: buildTrendAnalytics(campaign.trends)
      }))
      .filter((campaign) => campaign.analytics?.series?.length > 0)
  ), [buildTrendAnalytics, orderedCampaignTrends]);

  const tooltipLabels = {
    revenue: 'Revenue',
    spend: 'AD Spend',
    orders: 'Orders',
    aov: 'AOV',
    roas: 'ROAS',
    cac: 'CAC'
  };

  const getTooltipMetricKey = (dataKey = '') =>
    dataKey.replace(/(Complete|Incomplete|Projected|MA)$/u, '').toLowerCase();

  const getTooltipMetricLabel = (metricKey) =>
    tooltipLabels[metricKey] || metricKey;


  const formatTooltipMetricValue = useCallback((metricKey, value) => {
    if (metricKey === 'roas') return `${Number(value || 0).toFixed(2)}x`;
    if (metricKey === 'orders') return Math.round(value || 0).toLocaleString();
    if (metricKey === 'revenue' || metricKey === 'spend' || metricKey === 'aov' || metricKey === 'cac') {
      return formatCurrency(value || 0, 0);
    }
    return Math.round(value || 0).toLocaleString();
  }, [formatCurrency]);

  const getTrendRangeLabel = useCallback((payload, fallbackLabel) => {
    const point = payload?.find(item => item?.payload)?.payload;
    const rangeEnd = point?.bucketExpectedEndDate || point?.bucketEndDate;
    if (point?.bucketStartDate && rangeEnd) {
      const startLabel = formatCountryTooltip(point.bucketStartDate);
      const endLabel = formatCountryTooltip(rangeEnd);
      if (point.bucketStartDate !== rangeEnd) {
        return `${startLabel} - ${endLabel}`;
      }
      return startLabel;
    }
    return formatCountryTooltip(fallbackLabel);
  }, [formatCountryTooltip]);

  const renderBucketTooltip = useCallback((metricKeyOverride) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const isInProgress = payload.some(item => item?.payload?.isIncomplete);
    const point = payload.find(item => item?.payload)?.payload;
    let rangeLabel = getTrendRangeLabel(payload, label);
    const displayItem = payload.find(item => (
      item?.value != null
      && !String(item?.dataKey).includes('Incomplete')
      && !String(item?.dataKey).includes('Projected')
    )) || (isInProgress
      ? payload.find(item => item?.value != null && String(item?.dataKey).includes('Incomplete'))
      : null)
      || payload.find(item => item?.value != null);
    const dataKey = String(displayItem?.dataKey || '');
    const metricKey = metricKeyOverride || getTooltipMetricKey(dataKey);
    let metricLabel = getTooltipMetricLabel(metricKey);
    const formattedValue = formatTooltipMetricValue(metricKey, displayItem?.value);
    const hasActualValue = payload.some(item => (
      item?.value != null && (
        String(item?.dataKey).includes('Complete') || String(item?.dataKey).includes('Incomplete')
      )
    ));

    if (dataKey.includes('Projected') && !hasActualValue) {
      metricLabel = `Projected ${metricLabel}`;
    }

    if (isInProgress && point?.bucketStartDate) {
      const getTurkeyToday = () => {
        const now = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
        const turkeyDate = new Date(now);
        turkeyDate.setHours(0, 0, 0, 0);
        return turkeyDate.getTime();
      };

      const rangeEnd = point.bucketExpectedEndDate || point.bucketEndDate;
      const startDate = parseLocalDate(point.bucketStartDate);
      const endDate = rangeEnd ? parseLocalDate(rangeEnd) : null;

      const formatDate = (date) => date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });

      if (startDate && endDate) {
        rangeLabel = `${formatDate(startDate)} - ${formatDate(endDate)} (in progress)`;
      }

      const today = getTurkeyToday();
      if (endDate) {
        const endTime = endDate.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((endTime - today) / (1000 * 60 * 60 * 24));

        if (daysLeft >= 0) {
          metricLabel += ` (${daysLeft} day${daysLeft !== 1 ? 's' : ''} left)`;
        }
      }
    }

    return (
      <div className="rounded-lg bg-white p-2 shadow-md border border-gray-100">
        <p className="text-xs text-gray-500">
          {rangeLabel}
        </p>
        <p className="text-sm font-medium text-gray-900">
          {metricLabel}: {formattedValue}
        </p>
      </div>
    );
  }, [formatTooltipMetricValue, getTooltipMetricKey, getTooltipMetricLabel, getTrendRangeLabel, parseLocalDate]);

  const renderMaTooltip = useCallback((metricKeyOverride, color) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const metricKey = metricKeyOverride || getTooltipMetricKey(payload?.[0]?.dataKey || '');
    const metricLabel = getTooltipMetricLabel(metricKey);
    const point = payload?.[0]?.payload || {};
    const dailyValue = point[metricKey];
    const maValue = point[`${metricKey}MA`];

    const maColor = color || '#64748b';
    const dailyColor = color ? `${color}66` : '#94a3b8';

    const dailyFormatted = dailyValue != null
      ? formatTooltipMetricValue(metricKey, dailyValue)
      : '—';
    const maFormatted = maValue != null
      ? formatTooltipMetricValue(metricKey, maValue)
      : '—';

    return (
      <div className="rounded-lg bg-white p-2 shadow-md border border-gray-100">
        <p className="text-xs text-gray-500">
          {formatCountryTooltip(label)}
        </p>
        <p className="text-sm font-medium text-gray-900">
          {metricLabel}
        </p>
        <div className="mt-1 space-y-1 text-xs text-gray-600">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: dailyColor }} />
              <span>Daily</span>
            </div>
            <span className="text-gray-900">{dailyFormatted}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: maColor }} />
              <span>{maWindow}d MA</span>
            </div>
            <span className="text-gray-900">{maFormatted}</span>
          </div>
        </div>
      </div>
    );
  }, [formatCountryTooltip, formatTooltipMetricValue, getTooltipMetricKey, getTooltipMetricLabel, maWindow]);

  const renderRegionBucketTooltip = useCallback((metricKeyOverride) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const metricKey = metricKeyOverride || 'orders';
    const capMetric = metricKey.charAt(0).toUpperCase() + metricKey.slice(1);
    const point = payload.find(item => item?.payload)?.payload;
    const isInProgress = payload.some(
      item => item?.payload?.europeIsIncomplete || item?.payload?.usaIsIncomplete
    );
    let rangeLabel = getTrendRangeLabel(payload, label);
    let metricLabel = getTooltipMetricLabel(metricKey);

    const hasActualValue = payload.some(item => (
      item?.value != null && (
        String(item?.dataKey).includes('Complete') || String(item?.dataKey).includes('Incomplete')
      )
    ));
    const hasProjectedValue = payload.some(
      item => item?.value != null && String(item?.dataKey).includes('Projected')
    );

    if (hasProjectedValue && !hasActualValue) {
      metricLabel = `Projected ${metricLabel}`;
    }

    if (isInProgress && point?.bucketStartDate) {
      const getTurkeyToday = () => {
        const now = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
        const turkeyDate = new Date(now);
        turkeyDate.setHours(0, 0, 0, 0);
        return turkeyDate.getTime();
      };

      const rangeEnd = point.bucketExpectedEndDate || point.bucketEndDate;
      const startDate = parseLocalDate(point.bucketStartDate);
      const endDate = rangeEnd ? parseLocalDate(rangeEnd) : null;

      const formatDate = (date) => date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });

      if (startDate && endDate) {
        rangeLabel = `${formatDate(startDate)} - ${formatDate(endDate)} (in progress)`;
      }

      const today = getTurkeyToday();
      if (endDate) {
        const endTime = endDate.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((endTime - today) / (1000 * 60 * 60 * 24));
        if (daysLeft >= 0) {
          metricLabel += ` (${daysLeft} day${daysLeft !== 1 ? 's' : ''} left)`;
        }
      }
    }

    const getRegionValue = (prefix) => {
      const projectedKey = `${prefix}${capMetric}Projected`;
      const completeKey = `${prefix}${capMetric}Complete`;
      const incompleteKey = `${prefix}${capMetric}Incomplete`;
      const completeItem = payload.find(item => item?.dataKey === completeKey && item?.value != null);
      if (completeItem) return completeItem.value;
      const incompleteItem = payload.find(item => item?.dataKey === incompleteKey && item?.value != null);
      if (incompleteItem) return incompleteItem.value;
      const projectedItem = payload.find(item => item?.dataKey === projectedKey && item?.value != null);
      return projectedItem ? projectedItem.value : null;
    };

    const europeValue = getRegionValue('europe');
    const usaValue = getRegionValue('usa');
    const formatRegionValue = (value) =>
      value == null ? '—' : formatTooltipMetricValue(metricKey, value);

    return (
      <div className="rounded-lg bg-white p-2 shadow-md border border-gray-100">
        <p className="text-xs text-gray-500">
          {rangeLabel}
        </p>
        <p className="text-sm font-medium text-gray-900">
          {metricLabel}
        </p>
        <div className="mt-1 space-y-1 text-sm font-medium text-gray-900">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COMPARE_COLORS.europe }} />
            <span>Europe:</span>
            <span>{formatRegionValue(europeValue)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COMPARE_COLORS.usa }} />
            <span>USA:</span>
            <span>{formatRegionValue(usaValue)}</span>
          </div>
        </div>
      </div>
    );
  }, [formatTooltipMetricValue, getTooltipMetricLabel, getTrendRangeLabel, parseLocalDate]);

  const renderRegionMaTooltip = useCallback((metricKeyOverride) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const metricKey = metricKeyOverride || 'orders';
    const capMetric = metricKey.charAt(0).toUpperCase() + metricKey.slice(1);
    const metricLabel = getTooltipMetricLabel(metricKey);
    const point = payload?.[0]?.payload || {};

    const europeColor = REGION_COMPARE_COLORS.europe;
    const usaColor = REGION_COMPARE_COLORS.usa;
    const europeDailyColor = `${europeColor}66`;
    const usaDailyColor = `${usaColor}66`;

    const europeDaily = point[`europe${capMetric}`];
    const europeMa = point[`europe${capMetric}MA`];
    const usaDaily = point[`usa${capMetric}`];
    const usaMa = point[`usa${capMetric}MA`];

    const formatValue = (value) =>
      value == null ? '—' : formatTooltipMetricValue(metricKey, value);

    return (
      <div className="rounded-lg bg-white p-2 shadow-md border border-gray-100">
        <p className="text-xs text-gray-500">
          {formatCountryTooltip(label)}
        </p>
        <p className="text-sm font-medium text-gray-900">
          {metricLabel}
        </p>
        <div className="mt-2 space-y-2 text-xs text-gray-600">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: europeColor }} />
              <span>Europe</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: europeDailyColor }} />
                <span>Daily</span>
              </div>
              <span className="text-gray-900">{formatValue(europeDaily)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: europeColor }} />
                <span>{maWindow}d MA</span>
              </div>
              <span className="text-gray-900">{formatValue(europeMa)}</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: usaColor }} />
              <span>USA</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: usaDailyColor }} />
                <span>Daily</span>
              </div>
              <span className="text-gray-900">{formatValue(usaDaily)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: usaColor }} />
                <span>{maWindow}d MA</span>
              </div>
              <span className="text-gray-900">{formatValue(usaMa)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }, [formatCountryTooltip, formatTooltipMetricValue, getTooltipMetricLabel, maWindow]);

  const renderTrendLine = ({ baseKey, stroke, lastBucketIncomplete, isIncompleteKey, showProjection }) => (
    <>
      <Line
        type="monotone"
        dataKey={`${baseKey}Complete`}
        stroke={stroke}
        strokeWidth={2}
        dot={false}
        fill="none"
      />
      {lastBucketIncomplete && (
        <Line
          type="monotone"
          dataKey={`${baseKey}Incomplete`}
          stroke={stroke}
          strokeWidth={2}
          dot={({ cx, cy, payload }) => {
            if (!payload?.[isIncompleteKey] || cx == null || cy == null) return null;
            return (
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill="white"
                stroke={stroke}
                strokeWidth={2}
              />
            );
          }}
          strokeDasharray="5,5"
          fill="none"
        />
      )}
      {showProjection && (
        <Line
          type="monotone"
          dataKey={`${baseKey}Projected`}
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          connectNulls
          strokeDasharray="3,3"
          fill="none"
        />
      )}
    </>
  );

  const renderMaLines = ({ baseKey, stroke }) => {
    const dailyColor = `${stroke}66`;
    return (
      <>
        <Line
          type="monotone"
          dataKey={`${baseKey}MA`}
          stroke={stroke}
          strokeWidth={2.5}
          dot={false}
          activeDot={false}
        />
        <Line
          type="monotone"
          dataKey={baseKey}
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          strokeOpacity={0}
          legendType="none"
          activeDot={({ cx, cy }) => {
            if (cx == null || cy == null) return null;
            return (
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill={dailyColor}
                stroke={stroke}
                strokeWidth={1.5}
              />
            );
          }}
          isAnimationActive={false}
        />
      </>
    );
  };

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

  const handleOrdersCardClick = () => {
    setShowOrdersTrend(prev => !prev);
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
    campaignName: campaignScopeLabel,
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

  const formatDeltaPercent = (value) => {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.abs(value) >= 100 ? 0 : 1;
    return `${value > 0 ? '+' : ''}${value.toFixed(rounded)}%`;
  };

  const formatTimeLabel = (value) => {
    if (!value) return null;
    return value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatSummaryTimestamp = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFixed = (value, decimals = 2) => {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(decimals);
  };

  const calcMetricDelta = (value, base, unit) => {
    if (!Number.isFinite(value) || !Number.isFinite(base)) return null;
    const delta = value - base;
    if (value === 0 || base === 0) {
      return { value: delta, format: 'absolute', unit };
    }
    return { value: (delta / base) * 100, format: 'percent', unit };
  };

  const alertMetrics = [
    { key: 'revenue', label: 'Revenue', format: 'currency', goodDirection: 'up' },
    { key: 'orders', label: 'Orders', format: 'number', goodDirection: 'up' },
    { key: 'roas', label: 'ROAS', format: 'roas', goodDirection: 'up' },
    { key: 'cac', label: 'CAC', format: 'currency', goodDirection: 'down' },
    { key: 'aov', label: 'AOV', format: 'currency', goodDirection: 'up' },
    { key: 'spend', label: 'Spend', format: 'currency', goodDirection: 'neutral' }
  ];

  // Alerts fire only on large anomalies or sustained trends with high signal strength.
  const smartAlerts = useMemo(() => {
    if (!Array.isArray(trends) || trends.length < 8) return [];
    const results = [];

    alertMetrics.forEach((metric) => {
      const values = trends
        .map((point) => toNumber(point?.[metric.key]))
        .filter((value) => Number.isFinite(value));

      if (values.length < 8) return;

      const baselineWindow = Math.min(14, values.length - 1);
      const baselineValues = values.slice(-baselineWindow - 1, -1);
      const baselineMean = getMean(baselineValues);
      const baselineStd = getStandardDeviation(baselineValues, baselineMean);
      const current = values[values.length - 1];
      const changePct = baselineMean !== 0 ? (current - baselineMean) / Math.abs(baselineMean) : null;
      const zScore = baselineStd > 0 ? (current - baselineMean) / baselineStd : 0;

      let bestAlert = null;

      if (baselineWindow >= 7 && baselineStd > 0 && changePct != null) {
        const anomalySignal = Math.abs(zScore) >= 2.5 && Math.abs(changePct) >= 0.35;
        if (anomalySignal) {
          bestAlert = {
            id: `anomaly-${metric.key}`,
            type: 'anomaly',
            metricKey: metric.key,
            metricLabel: metric.label,
            format: metric.format,
            goodDirection: metric.goodDirection,
            direction: changePct >= 0 ? 'up' : 'down',
            currentValue: current,
            baselineValue: baselineMean,
            changePct,
            zScore,
            r2: null,
            window: baselineWindow,
            severity: Math.abs(zScore) * 10 + Math.abs(changePct) * 100
          };
        }
      }

      const trendWindow = Math.min(14, values.length);
      const trendValues = values.slice(-trendWindow);
      if (trendValues.length >= 10) {
        const { slope, r2 } = getLinearRegressionStats(trendValues);
        const trendChange = trendValues[0] !== 0
          ? (trendValues[trendValues.length - 1] - trendValues[0]) / Math.abs(trendValues[0])
          : null;
        const trendSignal = trendChange != null && Math.abs(trendChange) >= 0.3 && r2 >= 0.65;

        if (trendSignal) {
          const trendAlert = {
            id: `trend-${metric.key}`,
            type: 'trend',
            metricKey: metric.key,
            metricLabel: metric.label,
            format: metric.format,
            goodDirection: metric.goodDirection,
            direction: slope >= 0 ? 'up' : 'down',
            currentValue: trendValues[trendValues.length - 1],
            baselineValue: trendValues[0],
            changePct: trendChange,
            zScore: null,
            r2,
            window: trendWindow,
            severity: Math.abs(trendChange) * 100 + r2 * 25
          };

          if (!bestAlert || trendAlert.severity > bestAlert.severity) {
            bestAlert = trendAlert;
          }
        }
      }

      if (bestAlert) {
        results.push(bestAlert);
      }
    });

    return results.sort((a, b) => b.severity - a.severity).slice(0, 6);
  }, [trends]);

  const formatAlertMetric = (value, format) => {
    if (format === 'currency') return renderMetric(value, 'currency', 0);
    if (format === 'roas') return renderMetric(value, 'roas', 2);
    if (format === 'number') return renderMetric(value, 'number');
    return renderMetric(value, 'number');
  };

  const getCreativeSummaryRangeLabel = () => {
    if (creativeSummaryRange.type === 'custom') {
      if (creativeSummaryRange.start && creativeSummaryRange.end) {
        return `${creativeSummaryRange.start} to ${creativeSummaryRange.end}`;
      }
      return 'Custom';
    }
    if (creativeSummaryRange.type === 'yesterday') return 'Yesterday';
    if (creativeSummaryRange.type === 'days' && creativeSummaryRange.value === 1) return 'Today';
    if (creativeSummaryRange.type === 'days' && creativeSummaryRange.value === 2) return 'Today & Yesterday';
    if (creativeSummaryRange.type === 'days') return `${creativeSummaryRange.value}D`;
    return 'Period';
  };

  const getCtrTrendRangeLabel = () => {
    if (ctrTrendRangeMode === 'dashboard') {
      if (dateRange?.startDate && dateRange?.endDate) {
        return `${dateRange.startDate} to ${dateRange.endDate}`;
      }
      return 'Dashboard';
    }
    if (ctrTrendRange.type === 'custom') {
      if (ctrTrendRange.start && ctrTrendRange.end) {
        return `${ctrTrendRange.start} to ${ctrTrendRange.end}`;
      }
      return 'Custom';
    }
    if (ctrTrendRange.type === 'yesterday') return 'Yesterday';
    if (ctrTrendRange.type === 'days' && ctrTrendRange.value === 1) return 'Today';
    if (ctrTrendRange.type === 'days' && ctrTrendRange.value === 2) return 'Today & Yesterday';
    if (ctrTrendRange.type === 'days') return `${ctrTrendRange.value}D`;
    return 'Period';
  };

  const renderCtrTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload || {};
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-sm">
        <div className="text-[11px] text-gray-500 mb-2">{label}</div>
        <div className="space-y-1">
          {ctrTrendSeries.map((series, idx) => {
            const value = row[`series_${idx}`];
            if (!Number.isFinite(value)) return null;
            const clicks = row[`series_${idx}_clicks`] ?? 0;
            const impressions = row[`series_${idx}_impressions`] ?? 0;
            return (
              <div key={series.key || idx} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: CTR_TREND_COLORS[idx % CTR_TREND_COLORS.length] }}
                  />
                  <span className="font-medium text-gray-700">{series.label || `Series ${idx + 1}`}</span>
                </div>
                <div className="text-gray-700">{renderMetric(value, 'percent', 2)}</div>
                <div className="text-[11px] text-gray-400">
                  {formatNumber(clicks)} clicks · {formatNumber(impressions)} impr
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCreativeSummaryValue = (value, format) => {
    if (!Number.isFinite(value)) return '—';
    if (format === 'currency') return renderMetric(value, 'currency');
    if (format === 'percent') return renderPercent(value, 2);
    if (format === 'frequency') return formatFixed(value, 2);
    if (format === 'number') return renderNumber(value);
    return formatFixed(value, 2);
  };

  const formatDeltaAbsolute = (value, unit) => {
    if (!Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    const absValue = Math.abs(value);

    if (unit === 'percent') {
      return `${sign}${absValue.toFixed(2)}%`;
    }
    if (unit === 'frequency') {
      return `${sign}${absValue.toFixed(2)}`;
    }
    if (unit === 'roas') {
      return `${sign}${absValue.toFixed(2)}`;
    }
    if (unit === 'currency') {
      return `${sign}${formatCurrency(absValue, 0)}`;
    }
    return `${sign}${formatNumber(absValue)}`;
  };

  const renderCreativeSummaryDelta = (delta) => {
    if (!delta || !Number.isFinite(delta.value)) {
      return <span className="text-xs text-gray-400">—</span>;
    }
    const isZero = delta.value === 0;
    const isPositive = delta.value > 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const classes = isZero
      ? 'bg-gray-100 text-gray-500'
      : (isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700');
    const label = delta.format === 'percent'
      ? formatDeltaPercent(delta.value)
      : formatDeltaAbsolute(delta.value, delta.unit);
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes}`}>
        {!isZero && <Icon className="h-3 w-3" />}
        {label}
      </span>
    );
  };

  const creativeSummaryCards = useMemo(() => {
    if (!creativeFunnelSummary) return null;

    const { baseline, leader, runnerUp, laggard, leaderMetrics, laggardMetrics } = creativeFunnelSummary;
    const delta = (value, base, unit) => calcMetricDelta(value, base, unit);

    const leaderVsSecond = runnerUp && runnerUp.purchases
      ? leader.purchases / Math.max(runnerUp.purchases, 1)
      : null;

    return {
      today: {
        title: 'Today',
        subtitle: 'Funnel change',
        body: `${leader?.name || 'Top creative'} leads the funnel with ${leader?.purchases || 0} purchases` +
          (leaderVsSecond ? ` (${leaderVsSecond.toFixed(1)}× vs #2).` : '.'),
        metrics: [
          {
            label: 'CTR',
            value: leaderMetrics.ctr,
            delta: delta(leaderMetrics.ctr, baseline.ctr, 'percent'),
            format: 'percent'
          },
          {
            label: 'ATC rate',
            value: leaderMetrics.atcRate,
            delta: delta(leaderMetrics.atcRate, baseline.atcRate, 'percent'),
            format: 'percent'
          },
          {
            label: 'CVR',
            value: leaderMetrics.cvr,
            delta: delta(leaderMetrics.cvr, baseline.cvr, 'percent'),
            format: 'percent'
          }
        ]
      },
      week: {
        title: 'This week',
        subtitle: 'Funnel drag',
        body: `${laggard?.name || 'Lowest creative'} is lagging the funnel` +
          (laggard?.purchases ? ` with ${laggard.purchases} purchases.` : '.'),
        metrics: [
          {
            label: 'CTR',
            value: laggardMetrics.ctr,
            delta: delta(laggardMetrics.ctr, baseline.ctr, 'percent'),
            format: 'percent'
          },
          {
            label: 'CVR',
            value: laggardMetrics.cvr,
            delta: delta(laggardMetrics.cvr, baseline.cvr, 'percent'),
            format: 'percent'
          },
          {
            label: 'ROAS',
            value: laggardMetrics.roas,
            delta: delta(laggardMetrics.roas, baseline.roas, 'roas'),
            format: 'roas'
          }
        ]
      }
    };
  }, [creativeFunnelSummary]);

  const creativeDataStrengthStyles = {
    LOW: 'bg-gray-100 text-gray-600',
    MED: 'bg-amber-100 text-amber-700',
    HIGH: 'bg-emerald-100 text-emerald-700'
  };

  const creativeVerdictStyles = {
    WINNER: 'bg-emerald-100 text-emerald-700',
    PROMISING: 'bg-amber-100 text-amber-700',
    NEUTRAL: 'bg-gray-100 text-gray-600',
    LOSER: 'bg-rose-100 text-rose-700',
    DEAD: 'bg-rose-200 text-rose-800'
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="px-3 py-1 bg-white rounded-lg shadow-sm text-sm text-gray-700">
          Scope: <span className="font-semibold text-gray-900">{campaignScopeLabel}</span>
        </div>
      </div>

      {kpiMonthSummaries.length > 0 && (
        <div className="grid grid-cols-6 gap-4">
          {kpiMonthSummaries.map((summary) => (
            <div
              key={summary.key}
              className={`relative rounded-full border px-3 py-1 text-[11px] font-semibold ${
                summary.tone === 'positive'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : summary.tone === 'negative'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-gray-50 text-gray-700 border-gray-200'
              } ${summary.isCelebrating ? 'summary-pill-celebrate summary-pill-intense pr-8' : ''}`}
            >
              <span>{summary.text}</span>
              {summary.isCelebrating && (
                <>
                  <span className="summary-emoji" aria-hidden="true">🎉</span>
                  <span className="summary-confetti" aria-hidden="true">
                    <span className="summary-confetti-dot confetti-dot-1" />
                    <span className="summary-confetti-dot confetti-dot-2" />
                    <span className="summary-confetti-dot confetti-dot-3" />
                    <span className="summary-confetti-dot confetti-dot-4" />
                    <span className="summary-confetti-dot confetti-dot-5" />
                    <span className="summary-confetti-dot confetti-dot-6" />
                    <span className="summary-confetti-dot confetti-dot-7" />
                    <span className="summary-confetti-dot confetti-dot-8" />
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* KPI CARDS */}
      <div className="grid grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <KPICard 
            key={kpi.key}
            kpi={kpi}
            trends={trends}
            expanded={kpi.key === 'orders' ? showOrdersTrend : expandedKpis.includes(kpi.key)}
            onToggle={kpi.key === 'orders' ? handleOrdersCardClick : () => toggleKpi(kpi.key)}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>

      {/* Smart Alerts */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold">Smart Alerts</h3>
            <p className="text-sm text-gray-500">
              Signals trigger only on large anomalies or sustained trends with statistical strength.
            </p>
          </div>
          <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            Signal window: 10-14 points
          </div>
        </div>
        {smartAlerts.length === 0 ? (
          <div className="mt-4 text-sm text-gray-500">
            No statistically significant alerts detected in this period.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {smartAlerts.map((alert) => {
              const tone = alert.goodDirection === 'neutral'
                ? 'neutral'
                : (alert.goodDirection === 'up'
                  ? (alert.direction === 'up' ? 'positive' : 'negative')
                  : (alert.direction === 'down' ? 'positive' : 'negative'));
              const toneStyles = tone === 'positive'
                ? 'bg-emerald-50 border-emerald-100'
                : tone === 'negative'
                  ? 'bg-rose-50 border-rose-100'
                  : 'bg-gray-50 border-gray-100';
              const ToneIcon = tone === 'positive' ? CheckCircle2 : AlertCircle;
              const TrendIcon = alert.direction === 'up' ? TrendingUp : TrendingDown;
              const changeLabel = formatDeltaPercent((alert.changePct || 0) * 100);

              return (
                <div key={alert.id} className={`rounded-xl border p-4 ${toneStyles}`}>
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      tone === 'positive'
                        ? 'bg-emerald-100 text-emerald-700'
                        : tone === 'negative'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-gray-200 text-gray-600'
                    }`}>
                      <ToneIcon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-gray-900">{alert.metricLabel}</div>
                        <span className="text-[11px] text-gray-500 uppercase tracking-wide">
                          {alert.type === 'anomaly' ? 'Anomaly' : 'Trend'}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        {alert.type === 'anomaly'
                          ? `${alert.metricLabel} ${alert.direction === 'up' ? 'spiked' : 'dropped'} ${changeLabel} vs ${alert.window}d baseline.`
                          : `${alert.metricLabel} ${alert.direction === 'up' ? 'rising' : 'falling'} ${changeLabel} over ${alert.window}d.`}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <TrendIcon className="h-3 w-3" />
                          {formatAlertMetric(alert.currentValue, alert.format)}
                        </span>
                        {alert.type === 'anomaly' && alert.zScore != null && (
                          <span>Z {alert.zScore.toFixed(2)}</span>
                        )}
                        {alert.type === 'trend' && alert.r2 != null && (
                          <span>R2 {alert.r2.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Global Orders Trend */}
      {hasTrendData && showOrdersTrend && (
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="text-lg font-semibold">Orders Trend</h3>
            {regionCompareActive && (
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COMPARE_COLORS.europe }} />
                  Europe
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COMPARE_COLORS.usa }} />
                  USA
                </span>
              </div>
            )}
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={regionCompareActive ? regionCompareChartData : (isBucketMode ? bucketedTrendsForChart : maTrends)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  content={regionCompareActive
                    ? (isBucketMode ? renderRegionBucketTooltip('orders') : renderRegionMaTooltip('orders'))
                    : (isBucketMode ? renderBucketTooltip('orders') : renderMaTooltip('orders', '#22c55e'))}
                />
                {regionCompareActive ? (
                  isBucketMode ? (
                    <>
                      {renderTrendLine({
                        baseKey: 'europeOrders',
                        stroke: REGION_COMPARE_COLORS.europe,
                        lastBucketIncomplete: europeLastBucketIncomplete,
                        isIncompleteKey: 'europeIsIncomplete',
                        showProjection: europeHasProjection
                      })}
                      {renderTrendLine({
                        baseKey: 'usaOrders',
                        stroke: REGION_COMPARE_COLORS.usa,
                        lastBucketIncomplete: usaLastBucketIncomplete,
                        isIncompleteKey: 'usaIsIncomplete',
                        showProjection: usaHasProjection
                      })}
                    </>
                  ) : (
                    <>
                      {renderMaLines({
                        baseKey: 'europeOrders',
                        stroke: REGION_COMPARE_COLORS.europe
                      })}
                      {renderMaLines({
                        baseKey: 'usaOrders',
                        stroke: REGION_COMPARE_COLORS.usa
                      })}
                    </>
                  )
                ) : (
                  isBucketMode ? (
                    renderTrendLine({
                      baseKey: 'orders',
                      stroke: '#22c55e',
                      lastBucketIncomplete,
                      isIncompleteKey: 'isIncomplete',
                      showProjection: bucketHasProjection
                    })
                  ) : (
                    renderMaLines({
                      baseKey: 'orders',
                      stroke: '#22c55e'
                    })
                  )
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Expanded KPI charts */}
      {expandedKpis.length > 0 && hasTrendData && (
        <div className="space-y-6">
          {expandedKpis.filter(key => key !== 'orders').map((key) => {
            const thisKpi = kpis.find(k => k.key === key);
            if (!thisKpi) return null;
            const capKey = capitalize(key);
            const europeBaseKey = `europe${capKey}`;
            const usaBaseKey = `usa${capKey}`;
            return (
              <div key={key} className="bg-white rounded-xl p-6 shadow-sm animate-fade-in">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <h3 className="text-lg font-semibold">{thisKpi.label} Trend</h3>
                  {regionCompareActive && (
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COMPARE_COLORS.europe }} />
                        Europe
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGION_COMPARE_COLORS.usa }} />
                        USA
                      </span>
                    </div>
                  )}
                </div>
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={regionCompareActive ? regionCompareChartData : (isBucketMode ? bucketedTrendsForChart : maTrends)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        content={regionCompareActive
                          ? (isBucketMode ? renderRegionBucketTooltip(key) : renderRegionMaTooltip(key))
                          : (isBucketMode ? renderBucketTooltip(key) : renderMaTooltip(key, thisKpi.color))}
                      />
                      {regionCompareActive ? (
                        isBucketMode ? (
                          <>
                            {renderTrendLine({
                              baseKey: europeBaseKey,
                              stroke: REGION_COMPARE_COLORS.europe,
                              lastBucketIncomplete: europeLastBucketIncomplete,
                              isIncompleteKey: 'europeIsIncomplete',
                              showProjection: europeHasProjection
                            })}
                            {renderTrendLine({
                              baseKey: usaBaseKey,
                              stroke: REGION_COMPARE_COLORS.usa,
                              lastBucketIncomplete: usaLastBucketIncomplete,
                              isIncompleteKey: 'usaIsIncomplete',
                              showProjection: usaHasProjection
                            })}
                          </>
                        ) : (
                          <>
                            {renderMaLines({
                              baseKey: europeBaseKey,
                              stroke: REGION_COMPARE_COLORS.europe
                            })}
                            {renderMaLines({
                              baseKey: usaBaseKey,
                              stroke: REGION_COMPARE_COLORS.usa
                            })}
                          </>
                        )
                      ) : (
                        isBucketMode ? (
                          renderTrendLine({
                            baseKey: key,
                            stroke: thisKpi.color,
                            lastBucketIncomplete,
                            isIncompleteKey: 'isIncomplete',
                            showProjection: bucketHasProjection
                          })
                        ) : (
                          renderMaLines({
                            baseKey: key,
                            stroke: thisKpi.color
                          })
                        )
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* UNIFIED CAMPAIGN SECTION — Redesigned Meta-style interface */}
      <UnifiedAnalytics
        analyticsMode={analyticsMode}
        setAnalyticsMode={setAnalyticsMode}
        dashboard={dashboard}
        countriesDataSource={countriesDataSource}
        metaAdManagerData={metaAdManagerData}
        metaAdManagerNotice={metaAdManagerNotice}
        adManagerBreakdown={adManagerBreakdown}
        setAdManagerBreakdown={setAdManagerBreakdown}
        hiddenCampaigns={hiddenCampaigns}
        setHiddenCampaigns={setHiddenCampaigns}
        selectedDiagnosticsCampaign={selectedDiagnosticsCampaign}
        setSelectedDiagnosticsCampaign={setSelectedDiagnosticsCampaign}
        showHiddenDropdown={showHiddenDropdown}
        setShowHiddenDropdown={setShowHiddenDropdown}
        includeInactive={includeInactive}
        setIncludeInactive={setIncludeInactive}
        expandedCampaigns={expandedCampaigns}
        setExpandedCampaigns={setExpandedCampaigns}
        expandedAdsets={expandedAdsets}
        setExpandedAdsets={setExpandedAdsets}
        loading={loading}
        store={store}
        formatCurrency={formatCurrency}
        formatNumber={formatNumber}
        setDiagnosticsExpanded={setDiagnosticsExpanded}
        dateRange={dateRange}
      />


      {/* FUNNEL DIAGNOSTICS - Campaign-level diagnostics */}
      {funnelDiagnostics && (
        <>
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Funnel analysis scope</div>
              <div className="text-xs text-gray-500">View all campaigns or focus on a specific one.</div>
            </div>
            <div className="flex items-center gap-2 min-w-[240px]">
              <select
                value={selectedDiagnosticsCampaign || ''}
                onChange={(e) => setSelectedDiagnosticsCampaign(e.target.value || null)}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              >
                <option value="">All campaigns</option>
                {diagnosticsCampaignOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {selectedDiagnosticsCampaign && (
                <button
                  onClick={() => setSelectedDiagnosticsCampaign(null)}
                  className="px-3 py-2 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <FunnelDiagnostics
            data={funnelDiagnostics}
            currency={store.currencySymbol === '$' ? 'USD' : 'SAR'}
            formatCurrency={formatCurrency}
            expanded={diagnosticsExpanded}
            setExpanded={setDiagnosticsExpanded}
            onClearSelection={() => setSelectedDiagnosticsCampaign(null)}
          />
        </>
      )}

      {/* Legacy Funnel Diagnostics */}
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
                  formatter={(value, name) => {
                    const metricKey = name === 'orders' ? 'orders' : 'revenue';
                    return [
                      formatTooltipMetricValue(metricKey, value),
                      getTooltipMetricLabel(metricKey)
                    ];
                  }}
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

      {/* Creative performance by campaign */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-6">
        <div className="p-6 border-b border-gray-100 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold">Creatives Performance</h2>
              <p className="text-sm text-gray-500">
                Ranked by purchases with AOV and ROAS for each creative.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-semibold text-gray-700">Creative view:</span>
                <button
                  onClick={() => setCreativeViewMode('aggregate')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    creativeViewMode === 'aggregate'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Aggregate
                </button>
                <button
                  onClick={() => setCreativeViewMode('country')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    creativeViewMode === 'country'
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  By country
                </button>
              </div>
              {selectedCreativeCampaign && (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <span>Campaign:</span>
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 font-semibold">
                    {selectedCreativeCampaign.isAggregate ? (
                      <span className="mr-2 text-[10px] font-bold tracking-wide">ALL</span>
                    ) : (
                      <span className="mr-1">{getCampaignEmoji(selectedCreativeCampaign.name)}</span>
                    )}
                    {selectedCreativeCampaign.name}
                  </span>
                  {selectedCreativeCampaign.isAggregate && (
                    <span className="text-[10px] text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Combined</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {creativeCampaignOptions.length > 0 ? (
            <>
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="lg:w-64">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaigns</div>
                  <div className="mt-2 flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                    {creativeCampaignOptions.map((campaign) => {
                      const isActive = campaign.id === selectedCreativeCampaignId;
                      return (
                        <button
                          key={campaign.id}
                          onClick={() => setSelectedCreativeCampaignId(campaign.id)}
                          className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors flex items-center gap-2 justify-between text-left ${
                            isActive
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            {campaign.isAggregate ? (
                              <span className="text-[10px] font-bold tracking-wide bg-white/20 px-2 py-0.5 rounded-full">ALL</span>
                            ) : (
                              <span>{getCampaignEmoji(campaign.name)}</span>
                            )}
                            <span className="truncate" title={campaign.name}>{campaign.name}</span>
                          </span>
                          {isActive && <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Active</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex-1 text-sm text-gray-500">
                  Select a campaign (or all campaigns) to rank creatives. Switch between aggregated view (combines matching creatives) or country subsections to inspect localized performance.
                </div>
              </div>
              {creativeTotals && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Spend', value: creativeTotals.spend, format: 'currency', decimals: 0 },
                    { label: 'Total Purchases', value: creativeTotals.purchases, format: 'number', decimals: 0 },
                    { label: 'ROAS', value: creativeTotals.roas, format: 'roas', decimals: 2 },
                    { label: 'CTR', value: creativeTotals.ctr, format: 'percent', decimals: 2 }
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">{item.label}</div>
                      <div className="text-base font-semibold text-gray-900 mt-1">
                        {renderMetric(item.value, item.format, item.decimals)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-500">
              No creatives available. Switch to Meta Ad Manager view to load campaign data.
            </div>
          )}
        </div>

        <div className="p-6 border-b border-gray-100 bg-gray-50/40">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-base font-semibold text-gray-900">CTR Trends</h3>
              <p className="text-xs text-gray-500">
                Daily link CTR. Compare up to {CTR_COMPARE_LIMIT} ads or countries.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
              <span>
                Range: <span className="font-semibold text-gray-700">{getCtrTrendRangeLabel()}</span>
              </span>
              {ctrTrendRangeMode === 'local' && (
                <button
                  type="button"
                  onClick={() => setCtrTrendRangeMode('dashboard')}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Use dashboard range
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">Campaign</span>
              <select
                value={selectedCreativeCampaignId || ''}
                onChange={(e) => {
                  setSelectedCreativeCampaignId(e.target.value);
                  setCtrTrendCompareIds(null);
                  setCtrTrendCompareError('');
                }}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white"
              >
                {creativeCampaignOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">Country</span>
              <select
                value={ctrTrendCountry}
                onChange={(e) => {
                  setCtrTrendCountry(e.target.value);
                  setCtrTrendCompareIds(null);
                  setCtrTrendCompareError('');
                }}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white min-w-[160px]"
              >
                <option value="ALL">All countries</option>
                {ctrCountryOptions.map((country) => (
                  <option key={country.code} value={country.code}>
                    {`${country.flag ? `${country.flag} ` : ''}${country.name} (${country.code})`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">Ad</span>
              <select
                value={ctrTrendAdId}
                onChange={(e) => {
                  setCtrTrendAdId(e.target.value);
                  setCtrTrendCompareIds(null);
                  setCtrTrendCompareError('');
                }}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white min-w-[200px]"
              >
                <option value="ALL">All ads</option>
                {ctrAdOptions.map((ad) => (
                  <option key={ad.id} value={ad.id}>
                    {ad.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">
                {ctrTrendIncludeInactive ? 'Active + inactive' : 'Active only'}
              </span>
              <button
                type="button"
                onClick={() => setCtrTrendIncludeInactive(prev => !prev)}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                  ctrTrendIncludeInactive ? 'bg-indigo-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    ctrTrendIncludeInactive ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600">
            <span className="text-gray-500">Range:</span>
            <button
              onClick={() => {
                setCtrTrendRangeMode('local');
                setCtrTrendRange({ type: 'days', value: 1 });
                setShowCtrTrendCustomPicker(false);
              }}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                ctrTrendRangeMode === 'local' && ctrTrendRange.type === 'days' && ctrTrendRange.value === 1
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => {
                setCtrTrendRangeMode('local');
                setCtrTrendRange({ type: 'yesterday', value: 1 });
                setShowCtrTrendCustomPicker(false);
              }}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                ctrTrendRangeMode === 'local' && ctrTrendRange.type === 'yesterday'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Yesterday
            </button>
            {[7, 14, 30].map(days => (
              <button
                key={days}
                onClick={() => {
                  setCtrTrendRangeMode('local');
                  setCtrTrendRange({ type: 'days', value: days });
                  setShowCtrTrendCustomPicker(false);
                }}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  ctrTrendRangeMode === 'local' && ctrTrendRange.type === 'days' && ctrTrendRange.value === days
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {days}D
              </button>
            ))}
            <button
              onClick={() => {
                setCtrTrendRangeMode('local');
                setShowCtrTrendCustomPicker((prev) => !prev);
                setCtrTrendRange({ type: 'custom', start: ctrTrendCustomRange.start, end: ctrTrendCustomRange.end });
              }}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                ctrTrendRangeMode === 'local' && ctrTrendRange.type === 'custom'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Custom
            </button>
          </div>

          {showCtrTrendCustomPicker && (
            <div className="mt-3 flex flex-wrap items-end gap-2 text-xs text-gray-600">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Start</label>
                <input
                  type="date"
                  value={ctrTrendCustomRange.start}
                  onChange={(e) => setCtrTrendCustomRange(prev => ({ ...prev, start: e.target.value }))}
                  max={ctrTrendCustomRange.end || getIstanbulDateString()}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">End</label>
                <input
                  type="date"
                  value={ctrTrendCustomRange.end}
                  onChange={(e) => setCtrTrendCustomRange(prev => ({ ...prev, end: e.target.value }))}
                  min={ctrTrendCustomRange.start}
                  max={getIstanbulDateString()}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (ctrTrendCustomRange.start && ctrTrendCustomRange.end) {
                    setCtrTrendRangeMode('local');
                    setCtrTrendRange({
                      type: 'custom',
                      start: ctrTrendCustomRange.start,
                      end: ctrTrendCustomRange.end
                    });
                    setShowCtrTrendCustomPicker(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"
              >
                Apply
              </button>
            </div>
          )}

          <div className="mt-4">
            {ctrTrendError && (
              <div className="text-xs text-rose-600 mb-2">{ctrTrendError}</div>
            )}
            {ctrTrendLoading ? (
              <div className="h-64 flex items-center justify-center text-sm text-gray-500">
                Loading CTR trends...
              </div>
            ) : ctrTrendChartData.length > 0 ? (
              <>
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={ctrTrendChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                      />
                      <Tooltip content={renderCtrTooltip} />
                      {ctrTrendSeries.map((series, idx) => (
                        <Line
                          key={series.key || idx}
                          type="monotone"
                          dataKey={`series_${idx}`}
                          stroke={CTR_TREND_COLORS[idx % CTR_TREND_COLORS.length]}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4 }}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                  {ctrTrendSeries.map((series, idx) => (
                    <div key={series.key || idx} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: CTR_TREND_COLORS[idx % CTR_TREND_COLORS.length] }}
                      />
                      <span className="font-semibold text-gray-700">{series.label || `Series ${idx + 1}`}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-gray-500">
                Select a campaign and optionally a country or ad to view CTR.
              </div>
            )}
          </div>

          {ctrTrendMode !== 'campaign' && (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Compare (max {CTR_COMPARE_LIMIT})
                </div>
                {ctrCompareOptions.length === 0 ? (
                  <div className="mt-2 text-xs text-gray-500">No options available.</div>
                ) : (
                  <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                    {ctrCompareOptions.map((option) => (
                      <label key={option.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={ctrTrendEffectiveCompareIds.includes(option.id)}
                          onChange={() => toggleCtrCompareId(option.id)}
                          className="accent-indigo-600"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                {ctrTrendCompareError && (
                  <div className="mt-2 text-xs text-rose-500">{ctrTrendCompareError}</div>
                )}
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Smart notes
                </div>
                {ctrSharpNotes.length === 0 ? (
                  <div className="mt-2 text-xs text-gray-500">
                    No sharp CTR slope signals in the last 6 days.
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {ctrSharpNotes.map((note) => {
                      const Icon = note.direction === 'up' ? TrendingUp : TrendingDown;
                      const tone = note.direction === 'up' ? 'text-emerald-600' : 'text-rose-600';
                      const directionLabel = note.direction === 'up' ? 'spike' : 'drop';
                      return (
                        <div key={`${note.label}-${note.startDate}`} className="flex items-start gap-2 text-xs">
                          <Icon className={`h-4 w-4 ${tone}`} />
                          <div>
                            <div className="font-semibold text-gray-900">{note.label}</div>
                            <div className="text-gray-600">
                              Sharp CTR {directionLabel} starting {note.startDate}: {note.slope >= 0 ? '+' : ''}
                              {note.slope.toFixed(2)} pp/day (r² {note.r2.toFixed(2)})
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {creativeAds.length > 0 ? (
            <table className="min-w-full">
              <thead>
                <tr className="text-xs uppercase text-gray-500 tracking-wide bg-gray-50">
                  <th
                    className="px-4 py-3 text-left cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'purchases',
                      direction: prev.field === 'purchases' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1">
                      Rank
                      {creativeSortConfig.field === 'purchases'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'name',
                      direction: prev.field === 'name' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1">
                      Creative
                      {creativeSortConfig.field === 'name'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'spend',
                      direction: prev.field === 'spend' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Spend
                      {creativeSortConfig.field === 'spend'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'impressions',
                      direction: prev.field === 'impressions' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Impressions
                      {creativeSortConfig.field === 'impressions'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'ctr',
                      direction: prev.field === 'ctr' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      CTR
                      {creativeSortConfig.field === 'ctr'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'atc',
                      direction: prev.field === 'atc' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Add to Cart
                      {creativeSortConfig.field === 'atc'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'atcRate',
                      direction: prev.field === 'atcRate' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      ATC Rate
                      {creativeSortConfig.field === 'atcRate'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'purchases',
                      direction: prev.field === 'purchases' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Purchases
                      {creativeSortConfig.field === 'purchases'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'visits',
                      direction: prev.field === 'visits' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Visits (V)
                      {creativeSortConfig.field === 'visits'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">
                    Baseline CVR
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'winProb',
                      direction: prev.field === 'winProb' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      Win Prob
                      {creativeSortConfig.field === 'winProb'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'p10',
                      direction: prev.field === 'p10' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      p10 CVR
                      {creativeSortConfig.field === 'p10'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left">Data Strength</th>
                  <th className="px-4 py-3 text-left">Verdict</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'aov',
                      direction: prev.field === 'aov' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      AOV
                      {creativeSortConfig.field === 'aov'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none"
                    onClick={() => setCreativeSortConfig(prev => ({
                      field: 'roas',
                      direction: prev.field === 'roas' && prev.direction === 'desc' ? 'asc' : 'desc'
                    }))}
                  >
                    <div className="flex items-center gap-1 justify-end">
                      ROAS
                      {creativeSortConfig.field === 'roas'
                        ? (creativeSortConfig.direction === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-indigo-600" />
                          : <ChevronDown className="w-3 h-3 text-indigo-600" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </div>
                  </th>
                </tr>
              </thead>
              {creativeViewMode === 'aggregate' ? (
                <tbody className="divide-y divide-gray-100">
                  {creativeRows.map((creative, idx) => (
                    <tr key={creative.key} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 max-w-xs truncate" title={creative.name}>
                        {creative.name}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.spend, 'currency')}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderNumber(creative.impressions)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.ctr, 'percent', 2)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderNumber(creative.atc)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.atcRate, 'percent', 2)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">{renderNumber(creative.purchases)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderNumber(creative.visits)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creativeBaselineCvr * 100, 'percent', 2)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.winProb != null ? creative.winProb * 100 : null, 'percent', 1)}</td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.p10 != null ? creative.p10 * 100 : null, 'percent', 2)}</td>
                      <td className="px-4 py-3 text-left text-sm">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${creativeDataStrengthStyles[creative.dataStrength.key] || 'bg-gray-100 text-gray-600'}`}>
                          {creative.dataStrength.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left text-sm">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${creativeVerdictStyles[creative.verdict.key] || 'bg-gray-100 text-gray-600'}`}>
                          {creative.verdict.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.aov, 'currency')}</td>
                      <td className="px-4 py-3 text-right text-sm text-green-700 font-semibold">{renderMetric(creative.roas, 'roas', 2)}</td>
                    </tr>
                  ))}
                </tbody>
              ) : (
                <tbody className="divide-y divide-gray-100">
                  {creativeCountrySections.map((section) => (
                    <Fragment key={section.code}>
                      <tr className="bg-gray-50">
                        <td colSpan={16} className="px-4 py-3 text-xs font-semibold text-gray-600">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{section.flag}</span>
                              <span>{section.name}</span>
                            </div>
                            <span className="text-xs text-gray-500">Total purchases: {renderNumber(section.totalPurchases)}</span>
                          </div>
                        </td>
                      </tr>
                      {section.rows.map((creative, idx) => (
                        <tr key={creative.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900 max-w-xs truncate" title={creative.name}>
                            {creative.name}
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.spend, 'currency')}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderNumber(creative.impressions)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.ctr, 'percent', 2)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderNumber(creative.atc)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.atcRate, 'percent', 2)}</td>
                          <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">{renderNumber(creative.purchases)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderNumber(creative.visits)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creativeBaselineCvr * 100, 'percent', 2)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.winProb != null ? creative.winProb * 100 : null, 'percent', 1)}</td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.p10 != null ? creative.p10 * 100 : null, 'percent', 2)}</td>
                          <td className="px-4 py-3 text-left text-sm">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${creativeDataStrengthStyles[creative.dataStrength.key] || 'bg-gray-100 text-gray-600'}`}>
                              {creative.dataStrength.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-left text-sm">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${creativeVerdictStyles[creative.verdict.key] || 'bg-gray-100 text-gray-600'}`}>
                              {creative.verdict.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{renderMetric(creative.aov, 'currency')}</td>
                          <td className="px-4 py-3 text-right text-sm text-green-700 font-semibold">{renderMetric(creative.roas, 'roas', 2)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              )}
            </table>
          ) : (
            <div className="p-6 text-sm text-gray-500">
              {creativeCampaignOptions.length === 0
                ? 'No campaign creatives to display.'
                : 'No creatives found for this campaign.'}
            </div>
          )}
        </div>

        <div className="p-6 pt-0">
          <div className="rounded-xl border border-gray-100 bg-white/80 p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setShowCreativeSummaryTable(prev => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Top 5 spenders funnel table
                </div>
                <div className="text-xs text-gray-500">
                  CTR, frequency, LPV, ATC rate, purchases, checkout rate, and CVR vs previous bucket.
                </div>
              </div>
              <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showCreativeSummaryTable ? 'rotate-180' : ''}`} />
            </button>

            {showCreativeSummaryTable && (
              <>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-gray-500">
                    Period: <span className="font-semibold text-gray-700">{getCreativeSummaryRangeLabel()}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600">
                  <span className="text-gray-500">Period:</span>
                  <button
                    onClick={() => { setCreativeSummaryRange({ type: 'days', value: 1 }); setShowCreativeSummaryCustomPicker(false); }}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                      creativeSummaryRange.type === 'days' && creativeSummaryRange.value === 1
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => { setCreativeSummaryRange({ type: 'yesterday', value: 1 }); setShowCreativeSummaryCustomPicker(false); }}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                      creativeSummaryRange.type === 'yesterday'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Yesterday
                  </button>
                  <button
                    onClick={() => { setCreativeSummaryRange({ type: 'days', value: 2 }); setShowCreativeSummaryCustomPicker(false); }}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                      creativeSummaryRange.type === 'days' && creativeSummaryRange.value === 2
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Today & Yesterday
                  </button>
                  {[3, 7, 14, 30].map(days => (
                    <button
                      key={days}
                      onClick={() => { setCreativeSummaryRange({ type: 'days', value: days }); setShowCreativeSummaryCustomPicker(false); }}
                      className={`px-3 py-1.5 rounded-lg border transition-colors ${
                        creativeSummaryRange.type === 'days' && creativeSummaryRange.value === days
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {days}D
                    </button>
                  ))}
                  <button
                    onClick={() => setShowCreativeSummaryCustomPicker((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                      creativeSummaryRange.type === 'custom'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {showCreativeSummaryCustomPicker && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 text-xs text-gray-600">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 mb-1">Start</label>
                      <input
                        type="date"
                        value={creativeSummaryCustomRange.start}
                        onChange={(e) => setCreativeSummaryCustomRange(prev => ({ ...prev, start: e.target.value }))}
                        max={creativeSummaryCustomRange.end || getIstanbulDateString()}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 mb-1">End</label>
                      <input
                        type="date"
                        value={creativeSummaryCustomRange.end}
                        onChange={(e) => setCreativeSummaryCustomRange(prev => ({ ...prev, end: e.target.value }))}
                        min={creativeSummaryCustomRange.start}
                        max={getIstanbulDateString()}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (creativeSummaryCustomRange.start && creativeSummaryCustomRange.end) {
                          setCreativeSummaryRange({
                            type: 'custom',
                            start: creativeSummaryCustomRange.start,
                            end: creativeSummaryCustomRange.end
                          });
                          setShowCreativeSummaryCustomPicker(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"
                    >
                      Apply
                    </button>
                  </div>
                )}

                <div className="mt-4 overflow-x-auto">
                  {creativeSummaryLoading ? (
                    <div className="text-sm text-gray-500">Loading creative funnel table...</div>
                  ) : creativeSummaryTopSpenders.length > 0 ? (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
                          <th className="px-3 py-2 text-left">Creative</th>
                          <th className="px-3 py-2 text-right">Spend</th>
                          <th className="px-3 py-2 text-right">CTR</th>
                          <th className="px-3 py-2 text-right">Frequency</th>
                          <th className="px-3 py-2 text-right">LPV</th>
                          <th className="px-3 py-2 text-right">ATC Rate</th>
                          <th className="px-3 py-2 text-right">Purchases</th>
                          <th className="px-3 py-2 text-right">Checkout Rate</th>
                          <th className="px-3 py-2 text-right">CVR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {creativeSummaryTopSpenders.map((row) => {
                          const previous = creativeSummaryPreviousMap.get(row.key);
                          const ctrDelta = calcMetricDelta(row.ctr, previous?.ctr, 'percent');
                          const frequencyDelta = calcMetricDelta(row.frequency, previous?.frequency, 'frequency');
                          const lpvDelta = calcMetricDelta(row.lpv, previous?.lpv, 'number');
                          const atcDelta = calcMetricDelta(row.atcRate, previous?.atcRate, 'percent');
                          const purchasesDelta = calcMetricDelta(row.purchases, previous?.purchases, 'number');
                          const checkoutDelta = calcMetricDelta(row.checkoutRate, previous?.checkoutRate, 'percent');
                          const cvrDelta = calcMetricDelta(row.cvr, previous?.cvr, 'percent');

                          return (
                            <tr key={row.key} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-900 font-semibold max-w-xs truncate" title={row.name}>
                                {row.name}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700">
                                {renderCreativeSummaryValue(row.spend, 'currency')}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.ctr, 'percent')}
                                  </span>
                                  {renderCreativeSummaryDelta(ctrDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.frequency, 'frequency')}
                                  </span>
                                  {renderCreativeSummaryDelta(frequencyDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.lpv, 'number')}
                                  </span>
                                  {renderCreativeSummaryDelta(lpvDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.atcRate, 'percent')}
                                  </span>
                                  {renderCreativeSummaryDelta(atcDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.purchases, 'number')}
                                  </span>
                                  {renderCreativeSummaryDelta(purchasesDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.checkoutRate, 'percent')}
                                  </span>
                                  {renderCreativeSummaryDelta(checkoutDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="font-semibold text-gray-900">
                                    {renderCreativeSummaryValue(row.cvr, 'percent')}
                                  </span>
                                  {renderCreativeSummaryDelta(cvrDelta)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-sm text-gray-500">
                      No creative funnel data available for this period.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="p-6 pt-0">
          <div className="rounded-xl border border-gray-100 bg-gradient-to-br from-slate-50 via-white to-white p-4">
            <button
              type="button"
              onClick={() => setShowCreativeFunnelSummary(prev => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                Creative funnel summary
              </div>
              <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showCreativeFunnelSummary ? 'rotate-180' : ''}`} />
            </button>

            {showCreativeFunnelSummary && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">Powered by GPT‑5.1</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Prompt: “Briefly analyze changes and provide insight”</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">Not auto-triggered</span>
                  <span className="text-xs text-gray-500">Run end of day or tap generate.</span>
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  <button
                    type="button"
                    onClick={() => setCreativeSummaryGeneratedAt(new Date())}
                    className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-800"
                  >
                    Generate summary
                  </button>
                  {creativeSummaryGeneratedAt && (
                    <span>Updated {formatTimeLabel(creativeSummaryGeneratedAt)}</span>
                  )}
                </div>

                {creativeSummaryCards ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    {[creativeSummaryCards.today, creativeSummaryCards.week].map((card) => (
                      <div
                        key={card.title}
                        className="rounded-xl border border-gray-100 bg-white/80 p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{card.title}</div>
                            <div className="text-sm font-semibold text-gray-900">{card.subtitle}</div>
                          </div>
                          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                            Creative vs avg
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-gray-600">{card.body}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                      {card.metrics.map((metric) => {
                        const deltaValue = metric.delta?.value;
                        const isZero = Number.isFinite(deltaValue) && deltaValue === 0;
                        const isPositive = Number.isFinite(deltaValue) ? deltaValue > 0 : null;
                        const pillClasses = Number.isFinite(deltaValue)
                          ? (isZero ? 'bg-gray-100 text-gray-500' : (isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'))
                          : 'bg-gray-100 text-gray-500';
                        const deltaLabel = metric.delta?.format === 'percent'
                          ? formatDeltaPercent(deltaValue)
                          : formatDeltaAbsolute(deltaValue, metric.delta?.unit);
                        return (
                          <div
                            key={metric.label}
                            className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${pillClasses}`}
                          >
                            <span className="text-gray-700">{metric.label}</span>
                            <span className="text-gray-900">
                              {renderMetric(metric.value, metric.format, metric.format === 'percent' ? 2 : 2)}
                            </span>
                            <span className="flex items-center gap-1 text-[11px]">
                              {Number.isFinite(deltaValue)
                                ? (
                                  <>
                                    {!isZero && (
                                      isPositive ? (
                                        <TrendingUp className="h-3 w-3" />
                                      ) : (
                                        <TrendingDown className="h-3 w-3" />
                                      )
                                    )}
                                    {deltaLabel}
                                  </>
                                )
                                : '—'}
                            </span>
                          </div>
                        );
                      })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-gray-500">
                    No creative funnel summary available yet. Load a campaign to compare ads.
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-gray-100 bg-white/80 p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setCreativeInsightPanelOpen(prev => !prev)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Creative funnel AI summary
                      </div>
                      <div className="text-xs text-gray-500">
                        {creativeInsightLlm.provider === 'deepseek'
                          ? (creativeInsightLlm.model === 'deepseek-reasoner'
                            ? 'DeepSeek Reasoner (Thinking)'
                            : 'DeepSeek Chat (Non-thinking)')
                          : 'OpenAI (auto)'} • auto end of day/week or manual
                      </div>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${creativeInsightPanelOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {creativeInsightPanelOpen && (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600">
                        <span className="text-gray-500">Mode:</span>
                        {['analyze', 'summarize'].map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setCreativeInsightMode(mode)}
                            className={`px-3 py-1.5 rounded-lg border transition-colors ${
                              creativeInsightMode === mode
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            {mode === 'analyze' ? 'Analyze' : 'Summarize'}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600">
                        <span className="text-gray-500">Model:</span>
                        <select
                          value={`${creativeInsightLlm.provider}:${creativeInsightLlm.model || 'auto'}`}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === 'openai:auto') {
                              setCreativeInsightLlm((prev) => ({ ...prev, provider: 'openai', model: '' }));
                              return;
                            }
                            if (value === 'deepseek:deepseek-chat') {
                              setCreativeInsightLlm((prev) => ({ ...prev, provider: 'deepseek', model: 'deepseek-chat' }));
                              return;
                            }
                            if (value === 'deepseek:deepseek-reasoner') {
                              setCreativeInsightLlm((prev) => ({ ...prev, provider: 'deepseek', model: 'deepseek-reasoner' }));
                            }
                          }}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                          title="AI model"
                        >
                          <option value="openai:auto">OpenAI (auto)</option>
                          <option value="deepseek:deepseek-chat">DeepSeek Chat (Non-thinking)</option>
                          <option value="deepseek:deepseek-reasoner">DeepSeek Reasoner (Thinking)</option>
                        </select>

                        {creativeInsightLlm.provider === 'deepseek' && (
                          <select
                            value={String(creativeInsightLlm.temperature ?? 1.0)}
                            onChange={(event) => setCreativeInsightLlm((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                            title="Temperature"
                          >
                            <option value="0">0.0</option>
                            <option value="1">1.0</option>
                            <option value="1.3">1.3</option>
                            <option value="1.5">1.5</option>
                          </select>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Prompt (editable)
                        </div>
                        <textarea
                          rows={3}
                          value={creativeInsightPrompts[creativeInsightMode] || ''}
                          onChange={(e) => setCreativeInsightPrompts(prev => ({
                            ...prev,
                            [creativeInsightMode]: e.target.value
                          }))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                        <span className="font-semibold text-gray-500">Verbosity:</span>
                        {['low', 'medium'].map((level) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() => setCreativeInsightVerbosity(prev => ({
                              ...prev,
                              [creativeInsightMode]: level
                            }))}
                            className={`px-3 py-1.5 rounded-lg border transition-colors ${
                              creativeInsightVerbosity[creativeInsightMode] === level
                                ? 'bg-gray-900 text-white border-gray-900'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            {level}
                          </button>
                        ))}
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-500">Auto-generate</span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = !creativeInsightAutoEnabled;
                              setCreativeInsightAutoEnabled(next);
                              syncCreativeInsightSettings({
                                updates: {
                                  autoEnabled: next,
                                  analyzePrompt: creativeInsightPrompts.analyze,
                                  summarizePrompt: creativeInsightPrompts.summarize,
                                  analyzeVerbosity: creativeInsightVerbosity.analyze,
                                  summarizeVerbosity: creativeInsightVerbosity.summarize
                                }
                              }).catch((error) => {
                                setCreativeInsightError(error.message || 'Failed to update auto setting.');
                              });
                            }}
                            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                              creativeInsightAutoEnabled ? 'bg-emerald-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                creativeInsightAutoEnabled ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <button
                          type="button"
                          onClick={handleCreativeInsightSaveSettings}
                          className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-4 py-1.5 font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          Save settings
                        </button>
                        <button
                          type="button"
                          onClick={handleCreativeInsightGenerate}
                          disabled={creativeInsightLoading}
                          className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-semibold text-white shadow-sm transition ${
                            creativeInsightLoading ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-500'
                          }`}
                        >
                          {creativeInsightLoading ? 'Generating…' : 'Generate summary'}
                        </button>
                        {creativeInsightSummary?.generated_at && (
                          <span>
                            Updated {formatSummaryTimestamp(creativeInsightSummary.generated_at)}
                          </span>
                        )}
                        {(creativeInsightSummary || creativeInsightStreamingText) && (
                          <button
                            type="button"
                            onClick={handleCreativeInsightDismiss}
                            className="ml-auto inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
                          >
                            <X className="h-3 w-3" />
                            Dismiss
                          </button>
                        )}
                      </div>

                      {creativeInsightError && (
                        <div className="text-xs text-rose-600">{creativeInsightError}</div>
                      )}

                      <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
                        {creativeInsightLoading && !creativeInsightStreamingText && (
                          <div className="text-sm text-gray-500">Generating AI summary…</div>
                        )}
                        {creativeInsightStreamingText && (
                          <div className="whitespace-pre-wrap">{creativeInsightStreamingText}</div>
                        )}
                        {!creativeInsightStreamingText && creativeInsightSummary?.content && (
                          <div className="whitespace-pre-wrap">{creativeInsightSummary.content}</div>
                        )}
                        {!creativeInsightLoading && !creativeInsightStreamingText && !creativeInsightSummary?.content && (
                          <div className="text-sm text-gray-500">
                            No AI summary yet. Generate one manually or wait for end-of-day/week auto runs.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Country order trends (collapsible) */}
      {annotatedCountryTrends.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <button
            onClick={() => setShowCountryTrends(!showCountryTrends)}
            className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div>
              <h2 className="text-lg font-semibold text-left">Order Trends by Country</h2>
              <p className="text-sm text-gray-500 text-left">
                Click to {showCountryTrends ? 'collapse' : 'expand'} analytics-ready trend views
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setCountryTrendsRangeMode('global')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      countryTrendsRangeMode === 'global'
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Follow dashboard range
                  </button>
                  <button
                    onClick={() => setCountryTrendsRangeMode('quick')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      countryTrendsRangeMode === 'quick'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Quick ranges
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="px-3 py-1 bg-gray-100 rounded-full font-medium">
                    {getCountryTrendRangeLabel()}
                  </span>
                </div>
              </div>
              {countryTrendsRangeMode === 'quick' && (
                <div className="flex flex-wrap items-center gap-2">
                  {countryTrendQuickOptions.map((option) => {
                    const isActive = countryTrendsQuickRange?.type === option.type && countryTrendsQuickRange?.value === option.value;
                    return (
                      <button
                        key={`${option.type}-${option.value}`}
                        onClick={() => {
                          setCountryTrendsRangeMode('quick');
                          setCountryTrendsQuickRange({ type: option.type, value: option.value });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          isActive
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {annotatedCountryTrends.map((country, idx) => {
                const meta = country.analytics?.meta;
                const series = country.analytics?.series || [];
                const changePct = meta?.changePct;
                const changeLabel = Number.isFinite(changePct) ? formatDeltaPercent(changePct * 100) : '—';
                const isUp = changePct != null ? changePct >= 0 : null;
                const changeClass = isUp == null
                  ? 'bg-gray-100 text-gray-500'
                  : (isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700');
                const trendLabel = meta?.slope > 0 ? 'Uptrend' : meta?.slope < 0 ? 'Downtrend' : 'Flat';
                const signalLabel = meta?.r2 >= 0.7 ? 'Strong' : meta?.r2 >= 0.45 ? 'Moderate' : 'Weak';
                const volatilityLabel = meta?.volatility == null
                  ? '—'
                  : (meta.volatility <= 0.25 ? 'Low' : meta.volatility <= 0.5 ? 'Medium' : 'High');
                const TrendIcon = meta?.slope >= 0 ? TrendingUp : TrendingDown;

                return (
                  <div
                    key={country.countryCode || country.country || country.countryName || idx}
                    className="border-t border-gray-100 pt-4 first:border-0 first:pt-0"
                  >
                    <div className="flex items-start justify-between flex-wrap gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{country.flag}</span>
                        <div>
                          <div className="font-semibold">{country.country}</div>
                          <div className="text-xs text-gray-500">{country.totalOrders} orders</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className={`px-2 py-1 rounded-full font-semibold ${changeClass}`}>
                          {changeLabel} vs prev {meta?.window || 7}d
                        </span>
                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          {trendLabel}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          Signal {signalLabel}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          Volatility {volatilityLabel}
                        </span>
                      </div>
                    </div>
                    <div className="h-40">
                      <ResponsiveContainer>
                        <ComposedChart data={series}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 10 }}
                            tickFormatter={formatCountryTick}
                          />
                          <YAxis
                            yAxisId="orders"
                            tick={{ fontSize: 10 }}
                            allowDecimals={false}
                          />
                          <YAxis
                            yAxisId="revenue"
                            orientation="right"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(value) => formatCurrency(value || 0, 0)}
                          />
                          <Tooltip
                            labelFormatter={formatCountryTooltip}
                            formatter={(value, name) => {
                              const label = String(name);
                              const isRevenue = label.toLowerCase().includes('revenue');
                              const formatted = isRevenue
                                ? formatCurrency(value || 0, 0)
                                : formatNumber(value || 0);
                              return [formatted, label];
                            }}
                          />
                          <Bar
                            yAxisId="orders"
                            dataKey="orders"
                            name="Orders"
                            fill="#c7d2fe"
                            barSize={8}
                            radius={[4, 4, 0, 0]}
                          />
                          <Line
                            yAxisId="orders"
                            dataKey="ordersMA"
                            name="Orders (7d MA)"
                            stroke="#4338ca"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            yAxisId="revenue"
                            dataKey="revenueMA"
                            name="Revenue (7d MA)"
                            stroke="#16a34a"
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <TrendIcon className="h-3 w-3" />
                      <span>Latest {formatNumber(meta?.lastOrders || 0)} orders</span>
                      <span>• Revenue {formatCurrency(meta?.lastRevenue || 0, 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Campaign order trends */}
      {annotatedCampaignTrends.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-6">
          <button
            onClick={() => setShowCampaignTrends(!showCampaignTrends)}
            className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div>
              <h2 className="text-lg font-semibold text-left">Order Trends by Campaign</h2>
              <p className="text-sm text-gray-500 text-left">
                Click to {showCampaignTrends ? 'collapse' : 'expand'} analytical trend views
              </p>
              {campaignTrendsDataSource && (
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                  <span>Data source:</span>
                  <span className={`inline-flex items-center px-2 py-1 rounded-full font-medium ${
                    campaignTrendsDataSource === 'Meta' ? 'bg-blue-50 text-blue-700' :
                    campaignTrendsDataSource === 'Salla' ? 'bg-green-50 text-green-700' :
                    'bg-purple-50 text-purple-700'
                  }`}>
                    {campaignTrendsDataSource}
                  </span>
                </div>
              )}
            </div>
            <div
              className={`transform transition-transform ${
                showCampaignTrends ? 'rotate-180' : ''
              }`}
            >
              <ChevronDown className="w-5 h-5 text-gray-500" />
            </div>
          </button>

          {showCampaignTrends && (
            <div className="p-6 pt-0 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setCampaignTrendsRangeMode('global')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      campaignTrendsRangeMode === 'global'
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Follow dashboard range
                  </button>
                  <button
                    onClick={() => setCampaignTrendsRangeMode('quick')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      campaignTrendsRangeMode === 'quick'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Quick ranges
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="px-3 py-1 bg-gray-100 rounded-full font-medium">
                    {getCampaignTrendRangeLabel()}
                  </span>
                </div>
              </div>
              {campaignTrendsRangeMode === 'quick' && (
                <div className="flex flex-wrap items-center gap-2">
                  {countryTrendQuickOptions.map((option) => {
                    const isActive = campaignTrendsQuickRange?.type === option.type && campaignTrendsQuickRange?.value === option.value;
                    return (
                      <button
                        key={`campaign-${option.type}-${option.value}`}
                        onClick={() => {
                          setCampaignTrendsRangeMode('quick');
                          setCampaignTrendsQuickRange({ type: option.type, value: option.value });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          isActive
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {annotatedCampaignTrends.map((campaign, idx) => {
                const meta = campaign.analytics?.meta;
                const series = campaign.analytics?.series || [];
                const changePct = meta?.changePct;
                const changeLabel = Number.isFinite(changePct) ? formatDeltaPercent(changePct * 100) : '—';
                const isUp = changePct != null ? changePct >= 0 : null;
                const changeClass = isUp == null
                  ? 'bg-gray-100 text-gray-500'
                  : (isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700');
                const trendLabel = meta?.slope > 0 ? 'Uptrend' : meta?.slope < 0 ? 'Downtrend' : 'Flat';
                const signalLabel = meta?.r2 >= 0.7 ? 'Strong' : meta?.r2 >= 0.45 ? 'Moderate' : 'Weak';
                const TrendIcon = meta?.slope >= 0 ? TrendingUp : TrendingDown;

                return (
                  <div
                    key={campaign.campaignId || campaign.campaignName || idx}
                    className="border-t border-gray-100 pt-4 first:border-0 first:pt-0"
                  >
                    <div className="flex items-start justify-between flex-wrap gap-4 mb-3">
                      <div>
                        <div className="font-semibold">{campaign.campaignName}</div>
                        <div className="text-xs text-gray-500">{campaign.totalOrders} orders</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className={`px-2 py-1 rounded-full font-semibold ${changeClass}`}>
                          {changeLabel} vs prev {meta?.window || 7}d
                        </span>
                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          {trendLabel}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          Signal {signalLabel}
                        </span>
                      </div>
                    </div>
                    <div className="h-40">
                      <ResponsiveContainer>
                        <ComposedChart data={series}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 10 }}
                            tickFormatter={formatCountryTick}
                          />
                          <YAxis
                            yAxisId="orders"
                            tick={{ fontSize: 10 }}
                            allowDecimals={false}
                          />
                          <Tooltip
                            labelFormatter={formatCountryTooltip}
                            formatter={(value, name) => {
                              const label = String(name);
                              const formatted = formatNumber(value || 0);
                              return [formatted, label];
                            }}
                          />
                          <Bar
                            yAxisId="orders"
                            dataKey="orders"
                            name="Orders"
                            fill="#bbf7d0"
                            barSize={8}
                            radius={[4, 4, 0, 0]}
                          />
                          <Line
                            yAxisId="orders"
                            dataKey="ordersMA"
                            name="Orders (7d MA)"
                            stroke="#15803d"
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <TrendIcon className="h-3 w-3" />
                      <span>Latest {formatNumber(meta?.lastOrders || 0)} orders</span>
                    </div>
                  </div>
                );
              })}
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
              <option value="vironax">Virona</option>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold mb-4">CAC Trend</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name, props) => {
                      const metricKey = getTooltipMetricKey(props?.dataKey || name);
                      return [
                        formatTooltipMetricValue(metricKey, value),
                        getTooltipMetricLabel(metricKey)
                      ];
                    }}
                  />
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
            <h3 className="font-semibold mb-4">Spend Trend</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name, props) => {
                      const metricKey = getTooltipMetricKey(props?.dataKey || name);
                      return [
                        formatTooltipMetricValue(metricKey, value),
                        getTooltipMetricLabel(metricKey)
                      ];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="spend"
                    name="Daily Spend"
                    stroke="#0ea5e9"
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
                  <Tooltip
                    formatter={(value, name, props) => {
                      const metricKey = getTooltipMetricKey(props?.dataKey || name);
                      return [
                        formatTooltipMetricValue(metricKey, value),
                        getTooltipMetricLabel(metricKey)
                      ];
                    }}
                  />
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

function FunnelDiagnostics({ data, currency = 'SAR', formatCurrency, expanded, setExpanded, onClearSelection }) {
  if (!data || !data.current) {
    return null;
  }

  const { current, previous, changes, sparklineData, campaignName } = data;

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
    <div className="bg-white rounded-xl shadow-sm mb-6 overflow-hidden">
      {/* Collapsible Header */}
      <div
        className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 border-b border-gray-100"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>🔍</span> Funnel Diagnostics
          </h2>
          {campaignName ? (
            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
              {campaignName}
            </span>
          ) : (
            <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm">
              All Campaigns
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {campaignName && onClearSelection && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearSelection();
              }}
              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              ✕ Clear Selection
            </button>
          )}
          <span className="text-gray-400 text-sm">
            {expanded ? '▲ Collapse' : '▼ Expand'}
          </span>
        </div>
      </div>

      {/* Collapsible Content */}
      {expanded && (
        <div className="p-6">
          {/* Benchmark Label */}
          <div className="flex justify-end mb-4">
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
                    <span className="text-lg">{alert.type === 'drop' ? '🔴' : '🟢'}</span>
                    <div>
                      <div className={`font-semibold ${alert.type === 'drop' ? 'text-red-700' : 'text-green-700'}`}>
                        {alert.type === 'drop' ? 'ALERT' : 'WIN'}: {alert.metric.toUpperCase()} {alert.type === 'drop' ? 'dropped' : 'improved'} {alert.change.toFixed(0)}%
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        → {alert.recommendation}
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
      )}
    </div>
  );
}

function AIExplorationTab({ store, API_BASE }) {
  const [mode, setMode] = useState(null); // null, 'analyze', 'summarize', 'decide'
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const [depth, setDepth] = useState('balanced');
  const [usedModel, setUsedModel] = useState(null);
  const inputRef = useRef(null);
  const resultRef = useRef(null);

  // Focus input when mode changes
  useEffect(() => {
    if (mode && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [mode]);

  // Scroll to result
  useEffect(() => {
    if (result || streamingText) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result, streamingText]);

  // ESC to go back
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && mode && !loading) {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, loading]);

  const handleBack = () => {
    setMode(null);
    setQuery('');
    setResult(null);
    setStreamingText('');
    setUsedModel(null);
  };

  // Regular submit (Analyze & Summarize)
  const handleSubmit = async (e, customQuery = null) => {
    e?.preventDefault();
    const q = customQuery || query.trim();
    if (!q || loading) return;

    setLoading(true);
    setResult(null);
    setStreamingText('');
    setUsedModel(null);

    try {
      const endpoint = mode === 'analyze' ? '/ai/analyze' : '/ai/summarize';
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, store: store.id })
      });

      const data = await response.json();
      if (data.success) {
        setResult({ type: 'success', content: data.answer });
        setUsedModel(data.model);
      } else {
        setResult({ type: 'error', content: data.error });
      }
    } catch (error) {
      setResult({ type: 'error', content: error.message });
    } finally {
      setLoading(false);
      setQuery('');
    }
  };

  // Streaming submit (Decide mode)
  const handleStreamingSubmit = async (e, customQuery = null) => {
    e?.preventDefault();
    const q = customQuery || query.trim();
    if (!q || loading) return;

    setLoading(true);
    setResult(null);
    setStreamingText('');
    setUsedModel(null);

    try {
      const response = await fetch(`${API_BASE}/ai/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, store: store.id, depth })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'delta') {
                fullText += data.text;
                setStreamingText(fullText);
              } else if (data.type === 'done') {
                setUsedModel(data.model);
                setResult({ type: 'success', content: fullText });
                setStreamingText('');
              } else if (data.type === 'error') {
                setResult({ type: 'error', content: data.error });
              }
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      setResult({ type: 'error', content: error.message });
    } finally {
      setLoading(false);
      setQuery('');
    }
  };

  const handleModeSubmit = (e, customQuery = null) => {
    if (mode === 'decide') {
      handleStreamingSubmit(e, customQuery);
    } else {
      handleSubmit(e, customQuery);
    }
  };

  const handleQuickQuestion = (q) => {
    setQuery(q);
    handleModeSubmit(null, q);
  };

  // Loading tips
  const loadingTips = [
    "Querying your database...",
    "Analyzing campaign performance...",
    "Finding patterns in your data...",
    "Forming recommendations...",
    "Calculating impact..."
  ];
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (loading && mode === 'decide' && !streamingText) {
      const interval = setInterval(() => {
        setTipIndex(i => (i + 1) % loadingTips.length);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [loading, mode, streamingText]);

  // Quick questions
  const analyzeQuestions = [
    "How many orders today?",
    "What's my ROAS this week?"
  ];

  const summarizeQuestions = [
    "Give me a weekly performance recap",
    "What trends do you see in my data?",
    "Any anomalies I should know about?"
  ];

  const decideTopics = [
    { icon: '📈', label: 'Scale', question: 'Which campaigns should I scale and by how much?' },
    { icon: '💰', label: 'Budget', question: 'How should I reallocate my budget for better results?' },
    { icon: '🧪', label: 'Testing', question: 'What A/B tests should I run next?' },
    { icon: '📉', label: 'Diagnose', question: 'Why did my metrics drop and how do I fix it?' },
    { icon: '👥', label: 'Audience', question: 'What audiences should I target or exclude?' },
    { icon: '🎨', label: 'Creative', question: 'Which ad creatives are working and which should I refresh?' },
    { icon: '🔄', label: 'Funnel', question: 'Where is my funnel leaking and how do I fix it?' },
    { icon: '🛑', label: 'Pause', question: 'Which campaigns or ads should I pause?' }
  ];

  const displayContent = streamingText || result?.content;

  // =========================================================================
  // MODE SELECTION SCREEN
  // =========================================================================
  if (!mode) {
    return (
      <div className="min-h-[600px] flex flex-col items-center justify-center p-8 animate-fadeIn">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-3 animate-slideDown">
            AI Analytics
          </h1>
          <p className="text-gray-500 text-lg animate-slideDown" style={{ animationDelay: '0.1s' }}>
            Ask anything about your {store.name} data
          </p>
        </div>

        <div className="flex gap-6 flex-wrap justify-center max-w-4xl">
          {/* Analyze Card */}
          <button
            onClick={() => setMode('analyze')}
            className="group w-64 bg-white rounded-2xl p-6 border-2 border-gray-100 hover:border-green-300 hover:shadow-xl hover:shadow-green-100/50 transition-all duration-300 hover:-translate-y-2 text-left animate-slideUp"
            style={{ animationDelay: '0.2s' }}
          >
            <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <span className="text-2xl">⚡</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Analyze</h2>
            <p className="text-gray-500 text-sm mb-3">Quick metrics & facts</p>
            <div className="space-y-1 mb-4 text-sm text-gray-600">
              <p>"How many orders today?"</p>
              <p>"What's my ROAS?"</p>
            </div>
            <div className="flex items-center gap-2 text-green-600 text-xs font-medium bg-green-50 px-3 py-1.5 rounded-full w-fit">
              <span>⚡</span>
              <span>Instant - GPT-5 nano</span>
            </div>
          </button>

          {/* Summarize Card */}
          <button
            onClick={() => setMode('summarize')}
            className="group w-64 bg-white rounded-2xl p-6 border-2 border-gray-100 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-100/50 transition-all duration-300 hover:-translate-y-2 text-left animate-slideUp"
            style={{ animationDelay: '0.3s' }}
          >
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <span className="text-2xl">📊</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Summarize</h2>
            <p className="text-gray-500 text-sm mb-3">Trends & patterns</p>
            <div className="space-y-1 mb-4 text-sm text-gray-600">
              <p>Weekly recaps</p>
              <p>Trend analysis</p>
              <p>Anomaly detection</p>
            </div>
            <div className="flex items-center gap-2 text-blue-600 text-xs font-medium bg-blue-50 px-3 py-1.5 rounded-full w-fit">
              <span>📊</span>
              <span>~15s - GPT-5 mini</span>
            </div>
          </button>

          {/* Decide Card */}
          <button
            onClick={() => setMode('decide')}
            className="group w-64 bg-white rounded-2xl p-6 border-2 border-gray-100 hover:border-purple-300 hover:shadow-xl hover:shadow-purple-100/50 transition-all duration-300 hover:-translate-y-2 text-left animate-slideUp"
            style={{ animationDelay: '0.4s' }}
          >
            <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <span className="text-2xl animate-pulse">🧠</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Decide</h2>
            <p className="text-gray-500 text-sm mb-3">Strategic decisions</p>
            <div className="space-y-1 mb-4 text-sm text-gray-600">
              <p>Scale / Pause campaigns</p>
              <p>Budget allocation</p>
              <p>Test design</p>
            </div>
            <div className="flex items-center gap-2 text-purple-600 text-xs font-medium bg-purple-50 px-3 py-1.5 rounded-full w-fit">
              <span>🧠</span>
              <span>Deep reasoning - GPT-5.1</span>
            </div>
          </button>
        </div>

        <div className="mt-12 text-center text-sm text-gray-400 animate-fadeIn" style={{ animationDelay: '0.5s' }}>
          <p>AI queries your database directly for real-time answers</p>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ANALYZE MODE
  // =========================================================================
  if (mode === 'analyze') {
    return (
      <div className="min-h-[600px] p-6 animate-fadeIn">
        <div className="flex items-center justify-between mb-8">
          <button onClick={handleBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors animate-slideRight">
            <span className="text-xl">←</span>
            <span>Back</span>
          </button>
          <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-full animate-slideLeft">
            <span>⚡</span>
            <span className="text-sm font-medium">GPT-5 nano</span>
          </div>
        </div>

        <div className="text-center mb-8 animate-slideDown">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Quick Analysis</h2>
          <p className="text-gray-500">Get instant answers from your database</p>
        </div>

        <form onSubmit={handleModeSubmit} className="mb-8 animate-slideUp max-w-2xl mx-auto">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl">⚡</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModeSubmit(e); } }}
              placeholder="Ask a quick question..."
              className="w-full pl-14 pr-14 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:border-green-400 focus:ring-4 focus:ring-green-100 outline-none transition-all duration-300"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-xl flex items-center justify-center transition-all duration-300 hover:scale-105 disabled:hover:scale-100"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>→</span>}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 ml-4">Press Enter or click → to send</p>
        </form>

        {!result && !loading && (
          <div className="animate-slideUp max-w-2xl mx-auto" style={{ animationDelay: '0.1s' }}>
            <p className="text-sm text-gray-500 mb-3">Try asking:</p>
            <div className="flex gap-3 flex-wrap">
              {analyzeQuestions.map((q, i) => (
                <button key={i} onClick={() => handleQuickQuestion(q)} className="px-4 py-3 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-xl text-sm text-gray-700 hover:text-green-700 transition-all duration-300 hover:-translate-y-1">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && !displayContent && (
          <div className="flex flex-col items-center justify-center py-16 animate-fadeIn">
            <div className="w-16 h-16 border-4 border-green-100 border-t-green-500 rounded-full animate-spin mb-4" />
            <p className="text-gray-600">Querying database...</p>
          </div>
        )}

        {(displayContent || result) && (
          <div ref={resultRef} className="animate-slideUp max-w-2xl mx-auto">
            <div className={`p-6 rounded-2xl ${result?.type === 'error' ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
              {result?.type === 'error' ? (
                <p className="text-red-600">Error: {result.content}</p>
              ) : (
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {displayContent}
                    {loading && <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-1" />}
                  </div>
                </div>
              )}
              {usedModel && !loading && (
                <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-200">Answered by {usedModel}</p>
              )}
            </div>

            {!loading && (
              <form onSubmit={handleModeSubmit} className="mt-6">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">💬</span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModeSubmit(e); } }}
                    placeholder="Ask follow-up question..."
                    className="w-full pl-12 pr-14 py-3 border-2 border-gray-200 rounded-xl focus:border-green-400 focus:ring-4 focus:ring-green-100 outline-none transition-all duration-300"
                  />
                  <button type="submit" disabled={!query.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-all duration-300">
                    <span>→</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // SUMMARIZE MODE
  // =========================================================================
  if (mode === 'summarize') {
    return (
      <div className="min-h-[600px] p-6 animate-fadeIn">
        <div className="flex items-center justify-between mb-8">
          <button onClick={handleBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors animate-slideRight">
            <span className="text-xl">←</span>
            <span>Back</span>
          </button>
          <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2 rounded-full animate-slideLeft">
            <span>📊</span>
            <span className="text-sm font-medium">GPT-5 mini</span>
          </div>
        </div>

        <div className="text-center mb-8 animate-slideDown">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Trends & Patterns</h2>
          <p className="text-gray-500">Get summaries, trends, and anomaly detection</p>
        </div>

        <form onSubmit={handleModeSubmit} className="mb-8 animate-slideUp max-w-2xl mx-auto">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl">📊</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModeSubmit(e); } }}
              placeholder="What would you like summarized?"
              className="w-full pl-14 pr-14 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none transition-all duration-300"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-xl flex items-center justify-center transition-all duration-300 hover:scale-105 disabled:hover:scale-100"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>→</span>}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 ml-4">Press Enter or click → to send</p>
        </form>

        {!result && !loading && (
          <div className="animate-slideUp max-w-2xl mx-auto" style={{ animationDelay: '0.1s' }}>
            <p className="text-sm text-gray-500 mb-3">Popular summaries:</p>
            <div className="flex gap-3 flex-wrap">
              {summarizeQuestions.map((q, i) => (
                <button key={i} onClick={() => handleQuickQuestion(q)} className="px-4 py-3 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl text-sm text-gray-700 hover:text-blue-700 transition-all duration-300 hover:-translate-y-1">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && !displayContent && (
          <div className="flex flex-col items-center justify-center py-16 animate-fadeIn">
            <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin mb-4" />
            <p className="text-gray-600">Analyzing patterns...</p>
          </div>
        )}

        {(displayContent || result) && (
          <div ref={resultRef} className="animate-slideUp max-w-3xl mx-auto">
            <div className={`rounded-2xl overflow-hidden ${result?.type === 'error' ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-200 shadow-lg'}`}>
              {result?.type === 'error' ? (
                <div className="p-6"><p className="text-red-600">Error: {result.content}</p></div>
              ) : (
                <>
                  <div className="bg-gradient-to-r from-blue-500 to-cyan-500 px-6 py-4">
                    <h3 className="text-white font-semibold flex items-center gap-2">
                      <span>📊</span>
                      Analysis Summary
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="prose prose-sm max-w-none">
                      <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                        {displayContent}
                        {loading && <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />}
                      </div>
                    </div>
                    {usedModel && !loading && (
                      <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-200">Analyzed by {usedModel}</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {!loading && (
              <form onSubmit={handleModeSubmit} className="mt-6">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">💬</span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModeSubmit(e); } }}
                    placeholder="Ask follow-up question..."
                    className="w-full pl-12 pr-14 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none transition-all duration-300"
                  />
                  <button type="submit" disabled={!query.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-all duration-300">
                    <span>→</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // DECIDE MODE
  // =========================================================================
  if (mode === 'decide') {
    return (
      <div className="min-h-[600px] p-6 animate-fadeIn">
        <div className="flex items-center justify-between mb-8">
          <button onClick={handleBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors animate-slideRight">
            <span className="text-xl">←</span>
            <span>Back</span>
          </button>
          <div className="flex items-center gap-2 text-purple-600 bg-purple-50 px-4 py-2 rounded-full animate-slideLeft">
            <span>🧠</span>
            <span className="text-sm font-medium">GPT-5.1</span>
          </div>
        </div>

        <div className="text-center mb-6 animate-slideDown">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Strategic Decisions</h2>
          <p className="text-gray-500">Get diagnosis, recommendations, and test designs</p>
        </div>

        {/* Depth Toggle - 4 options */}
        <div className="mb-8 animate-slideUp max-w-2xl mx-auto">
          <p className="text-sm text-gray-600 mb-3 text-center">How deep should I analyze?</p>
          <div className="flex gap-2">
            {[
              { id: 'instant', icon: '⚡', label: 'Instant', time: '~10s' },
              { id: 'fast', icon: '🏃', label: 'Fast', time: '~15s' },
              { id: 'balanced', icon: '🧠', label: 'Balanced', time: '~45s' },
              { id: 'deep', icon: '🔬', label: 'Deep', time: '~2min' }
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setDepth(option.id)}
                disabled={loading}
                className={`flex-1 py-3 px-2 rounded-xl border-2 transition-all duration-300 ${
                  depth === option.id
                    ? 'border-purple-400 bg-purple-50 shadow-lg shadow-purple-100'
                    : 'border-gray-200 hover:border-purple-200 hover:bg-purple-50/50'
                } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-xl mb-1">{option.icon}</div>
                <div className={`text-sm font-medium ${depth === option.id ? 'text-purple-700' : 'text-gray-700'}`}>
                  {option.label}
                </div>
                <div className="text-xs text-gray-400">{option.time}</div>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleModeSubmit} className="mb-8 animate-slideUp max-w-2xl mx-auto" style={{ animationDelay: '0.1s' }}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl">🧠</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModeSubmit(e); } }}
              placeholder="What decision do you need help with?"
              className="w-full pl-14 pr-14 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:border-purple-400 focus:ring-4 focus:ring-purple-100 outline-none transition-all duration-300"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 text-white rounded-xl flex items-center justify-center transition-all duration-300 hover:scale-105 disabled:hover:scale-100"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>▶</span>}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 ml-4">Press Enter or click ▶ to send</p>
        </form>

        {/* Topic Cards */}
        {!result && !loading && !streamingText && (
          <div className="animate-slideUp max-w-3xl mx-auto" style={{ animationDelay: '0.2s' }}>
            <p className="text-sm text-gray-500 mb-4 text-center">Or choose a topic:</p>
            <div className="grid grid-cols-4 gap-3">
              {decideTopics.map((topic, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickQuestion(topic.question)}
                  className="group p-4 bg-white border-2 border-gray-100 hover:border-purple-300 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-purple-100/50"
                >
                  <div className="text-2xl mb-2 group-hover:scale-110 transition-transform duration-300">
                    {topic.icon}
                  </div>
                  <div className="text-sm font-medium text-gray-700 group-hover:text-purple-700">
                    {topic.label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && !displayContent && (
          <div className="flex flex-col items-center justify-center py-16 animate-fadeIn">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 border-4 border-purple-100 rounded-full" />
              <div className="absolute inset-0 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl animate-pulse">🧠</span>
              </div>
            </div>
            <p className="text-gray-600 font-medium mb-2">Thinking deeply...</p>
            <p className="text-gray-400 text-sm animate-pulse">{loadingTips[tipIndex]}</p>
          </div>
        )}

        {/* Result */}
        {(displayContent || result) && (
          <div ref={resultRef} className="animate-slideUp max-w-3xl mx-auto">
            <div className={`rounded-2xl overflow-hidden ${result?.type === 'error' ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-200 shadow-lg'}`}>
              {result?.type === 'error' ? (
                <div className="p-6"><p className="text-red-600">Error: {result.content}</p></div>
              ) : (
                <>
                  <div className="bg-gradient-to-r from-purple-500 to-indigo-500 px-6 py-4">
                    <h3 className="text-white font-semibold flex items-center gap-2">
                      <span>🧠</span>
                      Strategic Recommendations
                      {loading && <span className="text-purple-200 text-sm ml-2">(thinking...)</span>}
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="prose prose-sm max-w-none">
                      <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                        {displayContent}
                        {loading && <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-1" />}
                      </div>
                    </div>
                    {usedModel && !loading && (
                      <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-200">
                        Powered by {usedModel} - Depth: {depth}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {!loading && (
              <form onSubmit={handleModeSubmit} className="mt-6">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">💬</span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModeSubmit(e); } }}
                    placeholder="Ask follow-up question..."
                    className="w-full pl-12 pr-14 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-400 focus:ring-4 focus:ring-purple-100 outline-none transition-all duration-300"
                  />
                  <button type="submit" disabled={!query.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-all duration-300">
                    <span>→</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
