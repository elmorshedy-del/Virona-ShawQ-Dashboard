import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const API_BASE = '/api';

const fetchJson = async (url, fallback = null) => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (error) {
    console.error('Error fetching', url, error);
    return fallback;
  }
};

const statusLabel = (status) => {
  if (!status) return 'UNKNOWN';
  return String(status).replace(/_/g, ' ');
};

export default function CreativePreview({ store }) {
  const storeId = store?.id || 'vironax';
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [ads, setAds] = useState([]);
  const [selectedAdAccount, setSelectedAdAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');

  const [accountsLoading, setAccountsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [adsLoading, setAdsLoading] = useState(false);
  const [pageError, setPageError] = useState('');

  const [activeAd, setActiveAd] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const requestCounter = useRef(0);

  useEffect(() => {
    let isMounted = true;
    const loadAccounts = async () => {
      setAccountsLoading(true);
      setPageError('');
      const data = await fetchJson(`${API_BASE}/meta/adaccounts?store=${storeId}`, { success: false, data: [] });
      if (!isMounted) return;
      if (data?.success) {
        const accounts = Array.isArray(data.data) ? data.data : [];
        setAdAccounts(accounts);
        if (accounts.length > 0) {
          setSelectedAdAccount((current) => current || accounts[0].id);
        }
      } else {
        setPageError(data?.error || 'Failed to load ad accounts.');
        setAdAccounts([]);
      }
      setAccountsLoading(false);
    };
    loadAccounts();
    return () => {
      isMounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    let isMounted = true;
    const loadCampaigns = async () => {
      if (!selectedAdAccount) {
        setCampaigns([]);
        setSelectedCampaign('');
        return;
      }
      setCampaignsLoading(true);
      setPageError('');
      const url = `${API_BASE}/meta/campaigns?store=${storeId}&adAccountId=${encodeURIComponent(selectedAdAccount)}`;
      const data = await fetchJson(url, { success: false, data: [] });
      if (!isMounted) return;
      if (data?.success) {
        const campaignList = Array.isArray(data.data) ? data.data : [];
        setCampaigns(campaignList);
        setSelectedCampaign((current) => current || campaignList[0]?.id || '');
      } else {
        setPageError(data?.error || 'Failed to load campaigns.');
        setCampaigns([]);
        setSelectedCampaign('');
      }
      setCampaignsLoading(false);
    };
    loadCampaigns();
    return () => {
      isMounted = false;
    };
  }, [selectedAdAccount, storeId]);

  useEffect(() => {
    let isMounted = true;
    const loadAds = async () => {
      if (!selectedCampaign) {
        setAds([]);
        return;
      }
      setAdsLoading(true);
      setPageError('');
      const url = `${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${storeId}`;
      const data = await fetchJson(url, { success: false, data: [] });
      if (!isMounted) return;
      if (data?.success) {
        setAds(Array.isArray(data.data) ? data.data : []);
      } else {
        setPageError(data?.error || 'Failed to load ads.');
        setAds([]);
      }
      setAdsLoading(false);
    };
    loadAds();
    return () => {
      isMounted = false;
    };
  }, [selectedCampaign, storeId]);

  const closeModal = () => {
    setActiveAd(null);
    setVideoInfo(null);
    setVideoError('');
    setVideoLoading(false);
  };

  const openAdModal = async (ad) => {
    setActiveAd(ad);
    setVideoInfo(null);
    setVideoError('');
    setVideoLoading(true);
    const requestId = requestCounter.current + 1;
    requestCounter.current = requestId;

    const data = await fetchJson(`${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}`, {
      success: false
    });

    if (requestCounter.current !== requestId) return;
    if (data?.success) {
      setVideoInfo(data.data || null);
    } else {
      setVideoError(data?.error || 'Failed to load video.');
    }
    setVideoLoading(false);
  };

  const renderVideoContent = () => {
    if (videoLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    if (videoError) {
      return <p className="text-sm text-red-600">{videoError}</p>;
    }

    if (!videoInfo?.video_id) {
      return <p className="text-sm text-gray-600">No video found for this ad.</p>;
    }

    if (!videoInfo?.source_url) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Video source URL is unavailable or expired.
          </p>
          {videoInfo?.permalink_url && (
            <a
              href={videoInfo.permalink_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
            >
              Open in Meta
            </a>
          )}
        </div>
      );
    }

    return (
      <video
        src={videoInfo.source_url}
        poster={videoInfo.thumbnail_url || undefined}
        controls
        autoPlay
        muted
        playsInline
        className="w-full rounded-lg bg-black"
      />
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Creative Preview</h2>
          <p className="text-sm text-gray-500">Preview Meta ad creatives without leaving the platform.</p>
        </div>
      </div>

      {pageError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-sm text-red-700 border border-red-100">
          {pageError}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Ad Account</label>
          <select
            value={selectedAdAccount}
            onChange={(e) => setSelectedAdAccount(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            disabled={accountsLoading}
          >
            {accountsLoading && <option>Loading accounts...</option>}
            {!accountsLoading && adAccounts.length === 0 && (
              <option value="">No ad accounts</option>
            )}
            {adAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name || account.id}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[240px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Campaign</label>
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            disabled={campaignsLoading || !selectedAdAccount}
          >
            {campaignsLoading && <option>Loading campaigns...</option>}
            {!campaignsLoading && campaigns.length === 0 && (
              <option value="">No campaigns found</option>
            )}
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name || campaign.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Ad</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Preview</th>
            </tr>
          </thead>
          <tbody>
            {adsLoading && (
              <tr>
                <td colSpan="3" className="px-4 py-8 text-center text-gray-500">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <span>Loading ads...</span>
                  </div>
                </td>
              </tr>
            )}

            {!adsLoading && ads.length === 0 && (
              <tr>
                <td colSpan="3" className="px-4 py-8 text-center text-gray-500">
                  {selectedCampaign ? 'No ads found for this campaign.' : 'Select a campaign to view ads.'}
                </td>
              </tr>
            )}

            {!adsLoading && ads.map((ad) => (
              <tr
                key={ad.id}
                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => openAdModal(ad)}
              >
                <td className="px-4 py-3 text-gray-900 font-medium">{ad.name}</td>
                <td className="px-4 py-3 text-gray-600">{statusLabel(ad.status)}</td>
                <td className="px-4 py-3">
                  {ad.thumbnail_url ? (
                    <img
                      src={ad.thumbnail_url}
                      alt={`${ad.name} thumbnail`}
                      className="w-16 h-10 object-cover rounded"
                    />
                  ) : (
                    <span className="text-xs text-gray-400">No thumbnail</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 p-6 z-10">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{activeAd.name}</h3>
                <p className="text-xs text-gray-500">Ad ID: {activeAd.id}</p>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderVideoContent()}
          </div>
        </div>
      )}
    </div>
  );
}
