import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, PlayCircle } from 'lucide-react';

const API_BASE = '/api';

const fetchJson = async (url, fallback = null) => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Creative Preview fetch error:', error);
    return fallback;
  }
};

const DEFAULT_MODAL_WIDTH = 'min(420px, 92vw)';
const LANDSCAPE_MODAL_WIDTH = 'min(960px, 92vw)';

export default function CreativePreview({ storeId }) {
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [ads, setAds] = useState([]);
  const [selectedAdAccount, setSelectedAdAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAd, setSelectedAd] = useState(null);
  const [videoData, setVideoData] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [mediaDimensions, setMediaDimensions] = useState({ width: null, height: null });

  useEffect(() => {
    let isMounted = true;
    async function loadAdAccounts() {
      setLoadingAccounts(true);
      setError('');
      const data = await fetchJson(`${API_BASE}/meta/adaccounts?store=${storeId}`, { data: [] });
      if (!isMounted) return;
      if (data?.error) {
        setError(data.error);
      }
      const accounts = Array.isArray(data?.data) ? data.data : [];
      setAdAccounts(accounts);
      setSelectedAdAccount(accounts[0]?.id || '');
      setLoadingAccounts(false);
    }

    loadAdAccounts();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    let isMounted = true;
    async function loadCampaigns() {
      if (!selectedAdAccount) {
        setCampaigns([]);
        setSelectedCampaign('');
        return;
      }
      setLoadingCampaigns(true);
      setError('');
      const data = await fetchJson(
        `${API_BASE}/meta/campaigns?store=${storeId}&adAccountId=${encodeURIComponent(selectedAdAccount)}`,
        { data: [] }
      );
      if (!isMounted) return;
      if (data?.error) {
        setError(data.error);
      }
      const campaignList = Array.isArray(data?.data) ? data.data : [];
      setCampaigns(campaignList);
      setSelectedCampaign(campaignList[0]?.id || '');
      setLoadingCampaigns(false);
    }

    loadCampaigns();

    return () => {
      isMounted = false;
    };
  }, [selectedAdAccount, storeId]);

  useEffect(() => {
    let isMounted = true;
    async function loadAds() {
      if (!selectedCampaign) {
        setAds([]);
        return;
      }
      setLoadingAds(true);
      setError('');
      const data = await fetchJson(
        `${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${storeId}`,
        { data: [] }
      );
      if (!isMounted) return;
      if (data?.error) {
        setError(data.error);
      }
      setAds(Array.isArray(data?.data) ? data.data : []);
      setLoadingAds(false);
    }

    loadAds();

    return () => {
      isMounted = false;
    };
  }, [selectedCampaign, storeId]);

  const hasVideoSource = Boolean(videoData?.source_url);
  const hasThumbnail = Boolean(videoData?.thumbnail_url);

  const modalMaxWidth = useMemo(() => {
    const { width, height } = mediaDimensions;
    if (!width || !height) {
      return DEFAULT_MODAL_WIDTH;
    }
    return width >= height ? LANDSCAPE_MODAL_WIDTH : DEFAULT_MODAL_WIDTH;
  }, [mediaDimensions]);

  const openAdModal = async (ad) => {
    setSelectedAd(ad);
    setModalOpen(true);
    setVideoData(null);
    setVideoError('');
    setMediaDimensions({ width: null, height: null });
    setLoadingVideo(true);

    const data = await fetchJson(`${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}`, null);
    setVideoData(data);
    setLoadingVideo(false);
    if (!data || data?.error) {
      setVideoError('Unable to load video data for this ad.');
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedAd(null);
    setVideoData(null);
    setVideoError('');
    setMediaDimensions({ width: null, height: null });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Creative Preview</h2>
        <p className="text-sm text-gray-500">
          Select an ad account and campaign to preview video creatives.
        </p>
      </div>
      <div className="flex flex-wrap gap-4 items-center mb-6">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">Ad Account</span>
          <select
            value={selectedAdAccount}
            onChange={(event) => setSelectedAdAccount(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[220px]"
          >
            {loadingAccounts ? (
              <option>Loading accounts...</option>
            ) : adAccounts.length === 0 ? (
              <option value="">No ad accounts</option>
            ) : (
              adAccounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.name || account.id}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">Campaign</span>
          <select
            value={selectedCampaign}
            onChange={(event) => setSelectedCampaign(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[260px]"
          >
            {loadingCampaigns ? (
              <option>Loading campaigns...</option>
            ) : campaigns.length === 0 ? (
              <option value="">No campaigns</option>
            ) : (
              campaigns.map(campaign => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name || campaign.id}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600">{error}</div>
      )}

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Ad</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Preview</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loadingAds && (
              <tr>
                <td colSpan="3" className="px-4 py-6 text-center text-gray-500">
                  Loading ads...
                </td>
              </tr>
            )}

            {!loadingAds && ads.length === 0 && (
              <tr>
                <td colSpan="3" className="px-4 py-6 text-center text-gray-500">
                  No ads found for this campaign.
                </td>
              </tr>
            )}

            {!loadingAds && ads.map(ad => (
              <tr
                key={ad.id}
                onClick={() => openAdModal(ad)}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{ad.name || ad.id}</div>
                  <div className="text-xs text-gray-400">{ad.id}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                    {ad.status || 'Unknown'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {ad.thumbnail_url ? (
                    <img
                      src={ad.thumbnail_url}
                      alt={`${ad.name || 'Ad'} thumbnail`}
                      className="h-10 w-16 object-cover rounded-md border border-gray-200"
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 py-6">
          <div
            className="bg-white rounded-xl shadow-xl w-full max-h-[92vh] flex flex-col"
            style={{ maxWidth: modalMaxWidth }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <PlayCircle className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-gray-900">
                  {selectedAd?.name || 'Ad Preview'}
                </span>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-lg hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            <div className="px-4 py-4 overflow-y-auto">
              {loadingVideo && (
                <div className="flex items-center justify-center py-10 text-gray-500">
                  Loading video...
                </div>
              )}

              {!loadingVideo && videoError && (
                <div className="text-sm text-red-600">{videoError}</div>
              )}

              {!loadingVideo && !videoError && videoData && (
                <>
                  {hasVideoSource ? (
                    <div className="flex items-center justify-center">
                      <video
                        src={videoData.source_url}
                        controls
                        autoPlay
                        className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
                        onLoadedMetadata={(event) => {
                          const { videoWidth, videoHeight } = event.currentTarget;
                          setMediaDimensions({
                            width: videoWidth || null,
                            height: videoHeight || null
                          });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="text-sm text-gray-600">
                        {videoData.video_id
                          ? 'Playable source is missing or expired for this ad.'
                          : 'No video found for this ad.'}
                      </div>

                      {hasThumbnail && (
                        <div className="flex items-center justify-center">
                          <img
                            src={videoData.thumbnail_url}
                            alt="Ad thumbnail"
                            className="w-full h-auto max-h-[85vh] object-contain rounded-lg border border-gray-200"
                            onLoad={(event) => {
                              const { naturalWidth, naturalHeight } = event.currentTarget;
                              setMediaDimensions({
                                width: naturalWidth || null,
                                height: naturalHeight || null
                              });
                            }}
                          />
                        </div>
                      )}

                      {videoData.permalink_url && (
                        <a
                          href={videoData.permalink_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Open in Facebook
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
