import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Layers, Rocket, Megaphone, Image as ImageIcon, AlertTriangle } from 'lucide-react';

const API_BASE = '/api';

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { error: text };
  }
}

function formatStatusLabel(status) {
  if (!status) return 'UNKNOWN';
  return String(status).replace(/_/g, ' ');
}

function StatusBadge({ status }) {
  const normalized = String(status || '').toUpperCase();
  const styleMap = {
    ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    PAUSED: 'bg-amber-50 text-amber-700 border-amber-200'
  };
  const classes = styleMap[normalized] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {formatStatusLabel(status)}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, subLabel }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
          {subLabel ? <div className="mt-1 text-xs text-slate-500">{subLabel}</div> : null}
        </div>
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export default function NeoMetaTab({ store, onOpenCampaignLauncher = () => {} }) {
  const storeId = store?.id || 'vironax';
  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAdAccountId, setSelectedAdAccountId] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [ads, setAds] = useState([]);

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);

  const [accountsError, setAccountsError] = useState('');
  const [campaignsError, setCampaignsError] = useState('');
  const [adsError, setAdsError] = useState('');

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  const fetchAdAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setAccountsError('');
    try {
      const response = await fetch(`${API_BASE}/meta/adaccounts?store=${encodeURIComponent(storeId)}`);
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load ad accounts (HTTP ${response.status})`);
      }

      const nextAccounts = Array.isArray(payload?.data) ? payload.data : [];
      setAdAccounts(nextAccounts);
      setSelectedAdAccountId((prev) => (
        nextAccounts.some((account) => account.id === prev) ? prev : (nextAccounts[0]?.id || '')
      ));
    } catch (error) {
      setAdAccounts([]);
      setSelectedAdAccountId('');
      setAccountsError(error?.message || 'Failed to load ad accounts');
    } finally {
      setLoadingAccounts(false);
    }
  }, [storeId]);

  const fetchCampaigns = useCallback(async () => {
    if (!selectedAdAccountId) {
      setCampaigns([]);
      setSelectedCampaignId('');
      return;
    }

    setLoadingCampaigns(true);
    setCampaignsError('');
    try {
      const params = new URLSearchParams({
        store: storeId,
        adAccountId: selectedAdAccountId
      });
      const response = await fetch(`${API_BASE}/meta/campaigns?${params.toString()}`);
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load campaigns (HTTP ${response.status})`);
      }

      const nextCampaigns = Array.isArray(payload?.data) ? payload.data : [];
      setCampaigns(nextCampaigns);
      setSelectedCampaignId((prev) => (
        nextCampaigns.some((campaign) => campaign.id === prev) ? prev : (nextCampaigns[0]?.id || '')
      ));
    } catch (error) {
      setCampaigns([]);
      setSelectedCampaignId('');
      setCampaignsError(error?.message || 'Failed to load campaigns');
    } finally {
      setLoadingCampaigns(false);
    }
  }, [storeId, selectedAdAccountId]);

  const fetchAds = useCallback(async () => {
    if (!selectedCampaignId || !selectedAdAccountId) {
      setAds([]);
      return;
    }

    setLoadingAds(true);
    setAdsError('');
    try {
      const params = new URLSearchParams({
        store: storeId,
        adAccountId: selectedAdAccountId
      });
      const response = await fetch(`${API_BASE}/meta/campaigns/${selectedCampaignId}/ads?${params.toString()}`);
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load ads (HTTP ${response.status})`);
      }
      setAds(Array.isArray(payload?.data) ? payload.data : []);
    } catch (error) {
      setAds([]);
      setAdsError(error?.message || 'Failed to load ads');
    } finally {
      setLoadingAds(false);
    }
  }, [storeId, selectedAdAccountId, selectedCampaignId]);

  useEffect(() => {
    fetchAdAccounts();
  }, [fetchAdAccounts]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Neo Meta Workspace</div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Campaign Structure</h2>
            <p className="mt-1 text-sm text-slate-600">
              Live account view for campaigns, ad sets context, and creatives.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                fetchAdAccounts();
                fetchCampaigns();
                fetchAds();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={onOpenCampaignLauncher}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Rocket className="h-4 w-4" />
              Open Launcher
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard icon={Layers} label="Ad Accounts" value={adAccounts.length} subLabel={storeId} />
        <SummaryCard icon={Megaphone} label="Campaigns" value={campaigns.length} subLabel="Selected account" />
        <SummaryCard icon={ImageIcon} label="Ads" value={ads.length} subLabel={selectedCampaign?.name || 'No campaign selected'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Ad Account</h3>
            {loadingAccounts ? <span className="text-xs text-slate-500">Loading...</span> : null}
          </div>
          <select
            value={selectedAdAccountId}
            onChange={(event) => setSelectedAdAccountId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={loadingAccounts || adAccounts.length === 0}
          >
            <option value="">Select account</option>
            {adAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name || account.id}
              </option>
            ))}
          </select>
          {accountsError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {accountsError}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Campaigns</h3>
            {loadingCampaigns ? <span className="text-xs text-slate-500">Loading...</span> : null}
          </div>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {campaigns.map((campaign) => {
              const isSelected = campaign.id === selectedCampaignId;
              return (
                <button
                  type="button"
                  key={campaign.id}
                  onClick={() => setSelectedCampaignId(campaign.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{campaign.name || campaign.id}</div>
                      <div className="mt-1 text-xs text-slate-500">{campaign.id}</div>
                    </div>
                    <StatusBadge status={campaign.effective_status || campaign.status} />
                  </div>
                </button>
              );
            })}
            {!loadingCampaigns && campaigns.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                No campaigns found for this account.
              </div>
            ) : null}
          </div>
          {campaignsError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {campaignsError}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Selected Campaign</h3>
            {loadingAds ? <span className="text-xs text-slate-500">Loading ads...</span> : null}
          </div>
          {selectedCampaign ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-medium text-slate-900">{selectedCampaign.name || selectedCampaign.id}</div>
              <div className="mt-1 text-xs text-slate-500">{selectedCampaign.id}</div>
              <div className="mt-2">
                <StatusBadge status={selectedCampaign.effective_status || selectedCampaign.status} />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              Select a campaign to inspect ads.
            </div>
          )}

          {adsError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {adsError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Ads</h3>
          <span className="text-xs text-slate-500">{ads.length} items</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ads.map((ad) => (
            <div key={ad.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{ad.name || ad.id}</div>
                  <div className="mt-1 text-xs text-slate-500">{ad.id}</div>
                </div>
                <StatusBadge status={ad.effective_status || ad.status} />
              </div>
              {ad.thumbnail_url ? (
                <img
                  src={ad.thumbnail_url}
                  alt={ad.name || 'Ad preview'}
                  className="mt-3 h-36 w-full rounded-md border border-slate-200 object-cover"
                />
              ) : (
                <div className="mt-3 flex h-36 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                  No preview available
                </div>
              )}
            </div>
          ))}
        </div>
        {!loadingAds && ads.length === 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            No ads found for the selected campaign.
          </div>
        ) : null}
      </div>
    </div>
  );
}
