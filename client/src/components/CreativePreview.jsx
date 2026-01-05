import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = '/api';

const EMPTY_VIDEO = {
  video_id: null,
  source_url: null,
  thumbnail_url: null,
  length: null,
  permalink_url: null,
  message: 'No video found for this ad.'
};

export default function CreativePreview({ store }) {
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [ads, setAds] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [error, setError] = useState('');

  const [activeAd, setActiveAd] = useState(null);
  const [videoData, setVideoData] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [mediaDimensions, setMediaDimensions] = useState({ width: null, height: null });
  const videoRef = useRef(null);
  const imageRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    setLoadingAccounts(true);
    setError('');
    fetch(`${API_BASE}/meta/adaccounts?store=${store.id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return data;
      })
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        setAdAccounts(list);
        if (list.length > 0) {
          setSelectedAccount(list[0].id);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || 'Failed to load ad accounts');
      })
      .finally(() => {
        if (isMounted) setLoadingAccounts(false);
      });

    return () => {
      isMounted = false;
    };
  }, [store.id]);

  useEffect(() => {
    if (!selectedAccount) {
      setCampaigns([]);
      setSelectedCampaign('');
      return;
    }

    let isMounted = true;
    setLoadingCampaigns(true);
    setError('');
    fetch(`${API_BASE}/meta/campaigns?store=${store.id}&adAccountId=${selectedAccount}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return data;
      })
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        setCampaigns(list);
        setSelectedCampaign(list[0]?.id || '');
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || 'Failed to load campaigns');
      })
      .finally(() => {
        if (isMounted) setLoadingCampaigns(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedAccount, store.id]);

  useEffect(() => {
    if (!selectedCampaign) {
      setAds([]);
      return;
    }

    let isMounted = true;
    setLoadingAds(true);
    setError('');
    fetch(
      `${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${store.id}&adAccountId=${selectedAccount}`
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return data;
      })
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        setAds(list);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || 'Failed to load ads');
      })
      .finally(() => {
        if (isMounted) setLoadingAds(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCampaign, selectedAccount, store.id]);

  useEffect(() => {
    if (modalOpen && videoRef.current) {
      videoRef.current.play().catch(() => undefined);
    }
  }, [modalOpen, videoData]);

  const handleAdClick = async (ad) => {
    setActiveAd(ad);
    setModalOpen(true);
    setVideoLoading(true);
    setVideoError('');
    setVideoData(null);
    setMediaDimensions({ width: null, height: null });

    try {
      const res = await fetch(
        `${API_BASE}/meta/ads/${ad.id}/video?store=${store.id}&adAccountId=${selectedAccount}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load video');
      }
      setVideoData(data || EMPTY_VIDEO);
    } catch (err) {
      setVideoError(err?.message || 'Failed to load video');
      setVideoData(EMPTY_VIDEO);
    } finally {
      setVideoLoading(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setActiveAd(null);
    setVideoData(null);
    setVideoError('');
  };

  const hasVideo = !!videoData?.source_url;
  const hasThumbnail = !hasVideo && !!videoData?.thumbnail_url;
  const showNoVideo = !videoLoading && (!videoData?.source_url && !videoData?.thumbnail_url);

  const modalMaxWidth = useMemo(() => {
    const width = mediaDimensions.width;
    const height = mediaDimensions.height;
    if (!width || !height) {
      return 'min(420px, 92vw)';
    }
    return width >= height ? 'min(960px, 92vw)' : 'min(420px, 92vw)';
  }, [mediaDimensions]);

  const handleVideoMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.videoWidth && video.videoHeight) {
      setMediaDimensions({ width: video.videoWidth, height: video.videoHeight });
    }
  };

  const handleImageLoad = () => {
    const image = imageRef.current;
    if (!image) return;
    if (image.naturalWidth && image.naturalHeight) {
      setMediaDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    }
  };

  const adRows = ads.map((ad) => ({
    id: ad.id,
    name: ad.name || 'Untitled ad',
    status: ad.effective_status || ad.status || 'UNKNOWN',
    thumbnail: ad.thumbnail_url
  }));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Ad Account</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[220px]"
            >
              {loadingAccounts && <option>Loading...</option>}
              {!loadingAccounts && adAccounts.length === 0 && (
                <option value="">No ad accounts</option>
              )}
              {adAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Campaign</label>
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[260px]"
              disabled={!selectedAccount || loadingCampaigns}
            >
              {loadingCampaigns && <option>Loading...</option>}
              {!loadingCampaigns && campaigns.length === 0 && (
                <option value="">No campaigns</option>
              )}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name || campaign.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Ad</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Preview</th>
              </tr>
            </thead>
            <tbody>
              {loadingAds && (
                <tr>
                  <td colSpan="3" className="px-4 py-6 text-center text-gray-500">
                    Loading ads...
                  </td>
                </tr>
              )}

              {!loadingAds && adRows.length === 0 && (
                <tr>
                  <td colSpan="3" className="px-4 py-6 text-center text-gray-500">
                    No ads found for this campaign.
                  </td>
                </tr>
              )}

              {adRows.map((ad) => (
                <tr
                  key={ad.id}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleAdClick(ad)}
                >
                  <td className="px-4 py-3 text-gray-700">{ad.name}</td>
                  <td className="px-4 py-3 text-gray-700">{ad.status}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {ad.thumbnail ? (
                      <img
                        src={ad.thumbnail}
                        alt="Ad thumbnail"
                        className="w-10 h-10 rounded object-cover"
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div
            className="bg-white rounded-xl shadow-xl w-full max-h-[92vh] flex flex-col"
            style={{ maxWidth: modalMaxWidth }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-800 truncate">
                {activeAd?.name || 'Ad Preview'}
              </div>
              <button
                onClick={closeModal}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="flex items-center justify-center">
                {videoLoading && (
                  <div className="text-sm text-gray-500">Loading media...</div>
                )}

                {!videoLoading && videoError && (
                  <div className="text-sm text-red-600">{videoError}</div>
                )}

                {!videoLoading && hasVideo && (
                  <video
                    ref={videoRef}
                    src={videoData.source_url}
                    autoPlay
                    controls
                    onLoadedMetadata={handleVideoMetadata}
                    className="w-full h-auto max-h-[85vh] object-contain"
                  />
                )}

                {!videoLoading && !hasVideo && hasThumbnail && (
                  <div className="text-center">
                    <img
                      ref={imageRef}
                      src={videoData.thumbnail_url}
                      alt="Ad thumbnail"
                      onLoad={handleImageLoad}
                      className="w-full h-auto max-h-[85vh] object-contain"
                    />
                    <p className="mt-3 text-sm text-gray-600">Playable video source unavailable.</p>
                    {videoData?.permalink_url && (
                      <button
                        onClick={() => window.open(videoData.permalink_url, '_blank')}
                        className="mt-3 px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg"
                      >
                        Open on Facebook
                      </button>
                    )}
                  </div>
                )}

                {!videoLoading && showNoVideo && (
                  <div className="text-sm text-gray-600 text-center">
                    <p>{videoData?.message || 'No video found for this ad.'}</p>
                    {videoData?.permalink_url && (
                      <button
                        onClick={() => window.open(videoData.permalink_url, '_blank')}
                        className="mt-3 px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg"
                      >
                        Open on Facebook
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
