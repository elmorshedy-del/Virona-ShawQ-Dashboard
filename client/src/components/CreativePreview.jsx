import { useEffect, useMemo, useState } from 'react';

export default function CreativePreview({ store, apiBase = '/api' }) {
  const [adAccounts, setAdAccounts] = useState([]);
  const [adAccountId, setAdAccountId] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [ads, setAds] = useState([]);
  const [loadingAdAccounts, setLoadingAdAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [selectedAd, setSelectedAd] = useState(null);
  const [videoState, setVideoState] = useState({
    loading: false,
    data: null,
    error: ''
  });

  const campaignsById = useMemo(() => {
    return new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  }, [campaigns]);

  useEffect(() => {
    let isActive = true;
    async function loadAdAccounts() {
      setLoadingAdAccounts(true);
      setErrorMessage('');
      setAdAccounts([]);
      setAdAccountId('');
      setCampaigns([]);
      setCampaignId('');
      setAds([]);

      try {
        const response = await fetch(`${apiBase}/meta/adaccounts?store=${store.id}`);
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json?.error || 'Failed to load ad accounts.');
        }
        if (!isActive) return;
        const accounts = Array.isArray(json?.data) ? json.data : [];
        setAdAccounts(accounts);
        if (accounts.length > 0) {
          setAdAccountId(accounts[0].id);
        }
      } catch (error) {
        if (!isActive) return;
        setErrorMessage(error.message || 'Failed to load ad accounts.');
      } finally {
        if (isActive) setLoadingAdAccounts(false);
      }
    }

    loadAdAccounts();
    return () => { isActive = false; };
  }, [apiBase, store.id]);

  useEffect(() => {
    if (!adAccountId) return;
    let isActive = true;
    async function loadCampaigns() {
      setLoadingCampaigns(true);
      setErrorMessage('');
      setCampaigns([]);
      setCampaignId('');
      setAds([]);

      try {
        const response = await fetch(
          `${apiBase}/meta/campaigns?store=${store.id}&adAccountId=${encodeURIComponent(adAccountId)}`
        );
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json?.error || 'Failed to load campaigns.');
        }
        if (!isActive) return;
        const data = Array.isArray(json?.data) ? json.data : [];
        setCampaigns(data);
        if (data.length > 0) {
          setCampaignId(data[0].id);
        }
      } catch (error) {
        if (!isActive) return;
        setErrorMessage(error.message || 'Failed to load campaigns.');
      } finally {
        if (isActive) setLoadingCampaigns(false);
      }
    }

    loadCampaigns();
    return () => { isActive = false; };
  }, [adAccountId, apiBase, store.id]);

  useEffect(() => {
    if (!campaignId) return;
    let isActive = true;
    async function loadAds() {
      setLoadingAds(true);
      setErrorMessage('');
      setAds([]);

      try {
        const response = await fetch(
          `${apiBase}/meta/campaigns/${campaignId}/ads?store=${store.id}`
        );
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json?.error || 'Failed to load ads.');
        }
        if (!isActive) return;
        setAds(Array.isArray(json?.data) ? json.data : []);
      } catch (error) {
        if (!isActive) return;
        setErrorMessage(error.message || 'Failed to load ads.');
      } finally {
        if (isActive) setLoadingAds(false);
      }
    }

    loadAds();
    return () => { isActive = false; };
  }, [campaignId, apiBase, store.id]);

  useEffect(() => {
    setSelectedAd(null);
  }, [adAccountId, campaignId]);

  useEffect(() => {
    if (!selectedAd) return;
    let isActive = true;
    async function loadVideo() {
      setVideoState({ loading: true, data: null, error: '' });
      try {
        const response = await fetch(
          `${apiBase}/meta/ads/${selectedAd.id}/video?store=${store.id}`
        );
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json?.error || 'Failed to load video.');
        }
        if (!isActive) return;
        setVideoState({ loading: false, data: json, error: '' });
      } catch (error) {
        if (!isActive) return;
        setVideoState({
          loading: false,
          data: null,
          error: error.message || 'Failed to load video.'
        });
      }
    }

    loadVideo();
    return () => { isActive = false; };
  }, [apiBase, selectedAd, store.id]);

  useEffect(() => {
    if (!selectedAd) {
      setVideoState({ loading: false, data: null, error: '' });
    }
  }, [selectedAd]);

  const selectedCampaignName = campaignsById.get(campaignId)?.name || '';

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Creative Preview</h2>
            <p className="text-sm text-gray-500">
              Select an ad account and campaign to preview video creatives inside the platform.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4">
          <div className="flex flex-col gap-2 min-w-[220px]">
            <span className="text-sm font-medium text-gray-700">Ad Account</span>
            <select
              value={adAccountId}
              onChange={(event) => setAdAccountId(event.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              disabled={loadingAdAccounts}
            >
              {loadingAdAccounts && <option>Loading...</option>}
              {!loadingAdAccounts && adAccounts.length === 0 && (
                <option value="">No ad accounts available</option>
              )}
              {!loadingAdAccounts && adAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2 min-w-[260px]">
            <span className="text-sm font-medium text-gray-700">Campaign</span>
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              disabled={loadingCampaigns || !adAccountId}
            >
              {loadingCampaigns && <option>Loading...</option>}
              {!loadingCampaigns && campaigns.length === 0 && (
                <option value="">No campaigns available</option>
              )}
              {!loadingCampaigns && campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name || campaign.id}
                </option>
              ))}
            </select>
          </div>

          {selectedCampaignName && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-700">Selected Campaign</span>
              <div className="px-3 py-2 rounded-lg bg-gray-50 text-sm text-gray-600 border border-gray-200">
                {selectedCampaignName}
              </div>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="mt-4 text-sm text-red-600">{errorMessage}</div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold">Ads</h3>
          <p className="text-sm text-gray-500">
            Click an ad to preview its video creative.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Ad</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
                <th className="text-left px-6 py-3 font-medium">Thumbnail</th>
              </tr>
            </thead>
            <tbody>
              {loadingAds && (
                <tr>
                  <td colSpan={3} className="px-6 py-6 text-center text-gray-500">
                    Loading ads...
                  </td>
                </tr>
              )}
              {!loadingAds && ads.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-500">
                    {campaignId ? 'No ads found for this campaign.' : 'Select a campaign to see ads.'}
                  </td>
                </tr>
              )}
              {!loadingAds && ads.map((ad) => (
                <tr
                  key={ad.id}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedAd(ad)}
                >
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {ad.name || ad.id}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                      {ad.effective_status || ad.status || 'UNKNOWN'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {ad.creative?.thumbnail_url || ad.creative?.image_url ? (
                      <img
                        src={ad.creative?.thumbnail_url || ad.creative?.image_url}
                        alt={`${ad.name || 'Ad'} thumbnail`}
                        className="h-12 w-20 object-cover rounded-md border border-gray-200"
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
      </div>

      {selectedAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSelectedAd(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Ad Creative Preview</h3>
                <p className="text-sm text-gray-500">{selectedAd.name || selectedAd.id}</p>
              </div>
              <button
                onClick={() => setSelectedAd(null)}
                className="text-gray-500 hover:text-gray-700 text-sm font-medium"
              >
                Close
              </button>
            </div>

            <div className="mt-4">
              {videoState.loading && (
                <div className="flex items-center justify-center h-64 text-gray-500">
                  Loading video...
                </div>
              )}

              {!videoState.loading && videoState.error && (
                <div className="text-sm text-red-600">{videoState.error}</div>
              )}

              {!videoState.loading && !videoState.error && videoState.data && (
                <>
                  {videoState.data.source_url ? (
                    <video
                      src={videoState.data.source_url}
                      controls
                      autoPlay
                      muted
                      playsInline
                      poster={videoState.data.thumbnail_url || undefined}
                      className="w-full rounded-lg border border-gray-200"
                    />
                  ) : (
                    <div className="text-sm text-gray-600">
                      <p>{videoState.data.message || 'No video found for this ad.'}</p>
                      {videoState.data.permalink_url && (
                        <a
                          href={videoState.data.permalink_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex mt-3 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
                        >
                          Open on Facebook
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
