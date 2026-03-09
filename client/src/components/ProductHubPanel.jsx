/**
 * ProductHubPanel — Lightweight product catalog panel.
 * Borrowed from CreativeProductionOS patterns.
 * Self-contained with own catalog loading, collection filtering, and product selection.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ExternalLink,
  Globe,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Tag
} from 'lucide-react';

const API_BASE = '/api';
const withStore = (path, store) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(store ?? 'vironax')}`;
const cn = (...c) => c.filter(Boolean).join(' ');

const COLLECTIONS = [
  { id: 'all', label: 'All' },
  { id: 'new_arrivals', label: 'New' },
  { id: 'best_sellers', label: 'Best' },
  { id: 'evergreen', label: 'Core' },
];

const SAMPLE_PRODUCTS = [
  { id: 'sample_1', name: 'Sample Product', price: 0, currency: 'USD', collection: 'all' },
];

const INTEGRATIONS = [
  { id: 'shopify', label: 'Shopify', color: '#96bf48' },
  { id: 'salla', label: 'Salla', color: '#5243aa' },
  { id: 'woocommerce', label: 'WooCommerce', color: '#7f54b3' },
];

const formatCurrency = (value, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(value);
  } catch {
    return `$${value}`;
  }
};

export default function ProductHubPanel({ store, onProductSelect }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [integrations, setIntegrations] = useState({ shopify: false, salla: false, woocommerce: false });
  const [selectedCollection, setSelectedCollection] = useState('all');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [dynamicSync, setDynamicSync] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withStore('/creative-studio/creative-os/catalog?limit=150', store));
      const data = await res.json();
      if (res.ok && data?.products?.length) {
        setProducts(data.products);
        if (data.integrations) {
          setIntegrations({
            shopify: !!data.integrations.shopify,
            salla: !!data.integrations.salla,
            woocommerce: !!data.integrations.woocommerce,
          });
        }
      } else {
        setProducts(SAMPLE_PRODUCTS);
      }
    } catch (_err) {
      setProducts(SAMPLE_PRODUCTS);
      setError('Could not load catalog');
    }
    setLoading(false);
  }, [store]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    if (!dynamicSync) return;
    const interval = setInterval(loadCatalog, 30000);
    return () => clearInterval(interval);
  }, [dynamicSync, loadCatalog]);

  const visibleProducts = useMemo(() => {
    let filtered = selectedCollection === 'all'
      ? products
      : products.filter((p) => p.collection === selectedCollection);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((p) => p.name?.toLowerCase().includes(q));
    }
    return filtered;
  }, [products, selectedCollection, searchQuery]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const handleImport = useCallback(async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(withStore('/creative-studio/creative-os/product/import-url', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: store || 'default-tenant', url: importUrl.trim() })
      });
      const data = await res.json();
      if (res.ok && data?.product) {
        setProducts((prev) => [data.product, ...prev]);
        setSelectedProductId(data.product.id);
        setImportUrl('');
      } else {
        setError(data?.error || 'Import failed');
      }
    } catch (_err) {
      setError('Import failed. Check the URL and try again.');
    }
    setImporting(false);
  }, [importUrl, store]);

  const handleSelect = (product) => {
    setSelectedProductId(product.id);
    if (onProductSelect) onProductSelect(product);
  };

  return (
    <div className="space-y-3">
      {/* Integrations */}
      <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Integrations</span>
        <div className="space-y-1.5">
          {INTEGRATIONS.map((integ) => (
            <div key={integ.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: integrations[integ.id] ? integ.color : '#d1d5db' }} />
                <span className="text-[11px] font-medium text-gray-600">{integ.label}</span>
              </div>
              <span className={cn('text-[9px] font-bold uppercase tracking-wider', integrations[integ.id] ? 'text-emerald-500' : 'text-gray-300')}>
                {integrations[integ.id] ? 'Connected' : 'Not set'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Collections */}
      <div className="flex gap-1 flex-wrap">
        {COLLECTIONS.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCollection(c.id)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all',
              selectedCollection === c.id
                ? 'bg-indigo-100 text-indigo-600 shadow-sm'
                : 'bg-gray-100/60 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-300" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products..."
          className="w-full pl-7 pr-3 py-1.5 rounded-xl border border-gray-100 bg-white/60 text-[11px] text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-200 focus:border-indigo-300 transition"
        />
      </div>

      {/* Dynamic Sync Toggle */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Live Price Sync</span>
        <div
          className={cn('relative w-8 h-4 rounded-full cursor-pointer transition-colors', dynamicSync ? 'bg-indigo-500' : 'bg-gray-200')}
          onClick={() => setDynamicSync(!dynamicSync)}
        >
          <div className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform', dynamicSync ? 'translate-x-4' : 'translate-x-0.5')} />
        </div>
      </div>

      {/* Product List */}
      <div className="rounded-2xl border border-gray-100/80 bg-white/70 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-[11px]">Loading catalog...</span>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-gray-400">
            <Package className="h-5 w-5 mb-2 opacity-40" />
            <span className="text-[11px]">No products found</span>
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto pm-scroll">
            {visibleProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => handleSelect(product)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-left transition-all hover:bg-gray-50/80',
                  selectedProductId === product.id && 'bg-indigo-50/50 border-l-2 border-indigo-400'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ShoppingBag className={cn('h-3 w-3 flex-shrink-0', selectedProductId === product.id ? 'text-indigo-500' : 'text-gray-300')} />
                  <span className="text-[11px] font-medium text-gray-700 truncate">{product.name}</span>
                </div>
                {product.price > 0 && (
                  <span className="text-[10px] font-mono font-semibold text-gray-500 ml-2 flex-shrink-0">
                    {formatCurrency(product.price, product.currency)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sync Button */}
      <button
        onClick={loadCatalog}
        disabled={loading}
        className="w-full py-1.5 rounded-xl text-[11px] font-medium text-gray-500 border border-gray-100 bg-white/60 flex items-center justify-center gap-1.5 hover:bg-gray-50 transition-all disabled:opacity-50"
      >
        <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} /> Sync Catalog
      </button>

      {/* Import by URL */}
      <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 block">Import by URL</span>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-300" />
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Paste product URL..."
              className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-gray-100 bg-white/60 text-[10px] text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-200 transition"
              onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
            />
          </div>
          <button
            onClick={handleImport}
            disabled={importing || !importUrl.trim()}
            className="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white disabled:opacity-40 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Go'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</div>
      )}

      {/* Selected Product */}
      {selectedProduct && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-3">
          <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 block mb-1">Selected</span>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-gray-800">{selectedProduct.name}</span>
            {selectedProduct.price > 0 && (
              <span className="text-[11px] font-mono font-bold text-indigo-600">
                {formatCurrency(selectedProduct.price, selectedProduct.currency)}
              </span>
            )}
          </div>
          <button
            onClick={() => onProductSelect?.(selectedProduct)}
            className="w-full mt-2 py-1.5 rounded-xl text-[10px] font-semibold text-white flex items-center justify-center gap-1.5 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            <Tag className="h-3 w-3" /> Add to Video Overlay
          </button>
        </div>
      )}
    </div>
  );
}
