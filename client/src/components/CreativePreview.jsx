import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = '/api';

const EMPTY_VIDEO = {
  video_id: null,
  source_url: null,
  embed_html: null,
  thumbnail_url: null,
  length: null,
  permalink_url: null,
  message: 'No video found for this ad.'
};

const filterStoreAccounts = (accounts, storeId) => {
  if (!Array.isArray(accounts)) return [];
  if (storeId === 'vironax') {
    const matched = accounts.filter(a => /virona shop/i.test(a?.name || ''));
    return matched.length > 0 ? matched : accounts;
  }
  if (storeId === 'shawq') {
    const matched = accounts.filter(a => /shawq\.co/i.test(a?.name || ''));
    return matched.length > 0 ? matched : accounts;
  }
  return accounts;
};

const toSafeFilename = (value, fallback = 'creative') => {
  const base = typeof value === 'string' ? value.trim() : '';
  const safe = base
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\./, '')
    .slice(0, 60);
  return safe || fallback;
};

export default function CreativePreview({ store }) {
  const storeId = typeof store === 'string' ? store : store?.id;

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

  const selectedAccountStorageKey = useMemo(
    () => (storeId ? `creative-preview:${storeId}:adAccount` : null),
    [storeId]
  );
  const selectedCampaignStorageKey = useMemo(
    () => (storeId && selectedAccount ? `creative-preview:${storeId}:${selectedAccount}:campaign` : null),
    [storeId, selectedAccount]
  );

  useEffect(() => {
    if (!storeId) return;
    let isMounted = true;
    setLoadingAccounts(true);
    setError('');

    fetch(`${API_BASE}/meta/adaccounts?store=${storeId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        const filtered = filterStoreAccounts(list, storeId);
        setAdAccounts(filtered);

        let next = filtered[0]?.id || '';
        if (selectedAccountStorageKey) {
          try {
            const saved = localStorage.getItem(selectedAccountStorageKey);
            if (saved && filtered.some(acc => acc.id === saved)) {
              next = saved;
            }
          } catch {
            // ignore
          }
        }
        setSelectedAccount(next);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || 'Failed to load ad accounts');
        setAdAccounts([]);
        setSelectedAccount('');
      })
      .finally(() => {
        if (isMounted) setLoadingAccounts(false);
      });

    return () => {
      isMounted = false;
    };
  }, [storeId, selectedAccountStorageKey]);

  useEffect(() => {
    if (!selectedAccountStorageKey) return;
    if (!selectedAccount) return;
    try {
      localStorage.setItem(selectedAccountStorageKey, selectedAccount);
    } catch {
      // ignore
    }
  }, [selectedAccount, selectedAccountStorageKey]);

  useEffect(() => {
    if (!storeId || !selectedAccount) {
      setCampaigns([]);
      setSelectedCampaign('');
      return;
    }

    let isMounted = true;
    setLoadingCampaigns(true);
    setError('');

    fetch(`${API_BASE}/meta/campaigns?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        setCampaigns(list);

        let next = list[0]?.id || '';
        if (selectedCampaignStorageKey) {
          try {
            const saved = localStorage.getItem(selectedCampaignStorageKey);
            if (saved && list.some(c => c.id === saved)) {
              next = saved;
            }
          } catch {
            // ignore
          }
        }
        setSelectedCampaign(next);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || 'Failed to load campaigns');
        setCampaigns([]);
        setSelectedCampaign('');
      })
      .finally(() => {
        if (isMounted) setLoadingCampaigns(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedAccount, selectedCampaignStorageKey, storeId]);

  useEffect(() => {
    if (!selectedCampaignStorageKey) return;
    if (!selectedCampaign) return;
    try {
      localStorage.setItem(selectedCampaignStorageKey, selectedCampaign);
    } catch {
      // ignore
    }
  }, [selectedCampaign, selectedCampaignStorageKey]);

  useEffect(() => {
    if (!storeId || !selectedCampaign) {
      setAds([]);
      return;
    }

    let isMounted = true;
    setLoadingAds(true);
    setError('');

    fetch(`${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
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
        setAds([]);
      })
      .finally(() => {
        if (isMounted) setLoadingAds(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCampaign, selectedAccount, storeId]);

  useEffect(() => {
    if (modalOpen && videoRef.current) {
      videoRef.current.play().catch(() => undefined);
    }
  }, [modalOpen, videoData]);

  const adsForDisplay = useMemo(() => (
    (ads || []).map(ad => ({
      id: ad.id,
      name: ad.name || 'Untitled ad',
      status: (ad.effective_status || ad.status || 'UNKNOWN').toUpperCase(),
      thumbnail: ad.thumbnail_url || null
    }))
  ), [ads]);

  const handleAdClick = async (ad) => {
    if (!storeId || !selectedAccount || !ad?.id) return;
    setActiveAd(ad);
    setModalOpen(true);
    setVideoLoading(true);
    setVideoError('');
    setVideoData(null);
    setMediaDimensions({ width: null, height: null });

    try {
      const res = await fetch(`${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}&adAccountId=${selectedAccount}`);
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
  const hasEmbed = !hasVideo && !!videoData?.embed_html;
  const hasThumbnail = !hasVideo && !hasEmbed && !!(videoData?.thumbnail_url || activeAd?.thumbnail);
  const displayThumbnail = videoData?.thumbnail_url || activeAd?.thumbnail;
  const showPermissionFallback = !hasVideo && !hasEmbed && hasThumbnail && videoData?.source_url === null;
  const showNoVideo = !hasVideo && !hasEmbed && !hasThumbnail;

  const modalMaxWidth = useMemo(() => {
    const width = mediaDimensions.width;
    const height = mediaDimensions.height;
    if (!width || !height) {
      return 'min(560px, 92vw)';
    }
    return width >= height ? 'min(1040px, 92vw)' : 'min(560px, 92vw)';
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

  const downloadProxyUrl = useMemo(() => {
    if (!hasVideo || !videoData?.source_url) return null;
    const filename = `${toSafeFilename(activeAd?.name, activeAd?.id || 'creative')}.mp4`;
    return `${API_BASE}/creative-studio/video/download?url=${encodeURIComponent(videoData.source_url)}&filename=${encodeURIComponent(filename)}`;
  }, [activeAd?.id, activeAd?.name, hasVideo, videoData?.source_url]);

  if (!storeId) {
    return (
      <div className="text-sm text-gray-600">
        No store selected.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-700">Ad Account</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[240px]"
              disabled={loadingAccounts}
            >
              {loadingAccounts && <option>Loading...</option>}
              {!loadingAccounts && adAccounts.length === 0 && <option value="">No ad accounts</option>}
              {adAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-700">Campaign</label>
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white min-w-[320px]"
              disabled={!selectedAccount || loadingCampaigns}
            >
              {loadingCampaigns && <option>Loading...</option>}
              {!loadingCampaigns && campaigns.length === 0 && <option value="">No campaigns</option>}
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
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-800">Ads</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {loadingAds ? 'Loading...' : `${adsForDisplay.length} ad${adsForDisplay.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        <div className="p-5">
          {loadingAds && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="rounded-2xl border border-gray-200 overflow-hidden animate-pulse">
                  <div className="aspect-video bg-gray-100" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-gray-100 rounded" />
                    <div className="h-3 bg-gray-100 rounded w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loadingAds && adsForDisplay.length === 0 && (
            <div className="text-sm text-gray-500">
              No ads found for this campaign.
            </div>
          )}

          {!loadingAds && adsForDisplay.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {adsForDisplay.map((ad) => (
                <button
                  key={ad.id}
                  type="button"
                  onClick={() => handleAdClick(ad)}
                  className="text-left rounded-2xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-indigo-200 transition-all"
                >
                  <div className="aspect-video bg-gray-50">
                    {ad.thumbnail ? (
                      <img
                        src={ad.thumbnail}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                        No thumbnail
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-medium text-gray-900 truncate">{ad.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{ad.status}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-h-[92vh] flex flex-col overflow-hidden"
            style={{ maxWidth: modalMaxWidth }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-800 truncate">
                {activeAd?.name || 'Ad Preview'}
              </div>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
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
                    className="w-full h-auto max-h-[80vh] object-contain rounded-xl"
                  />
                )}

                {!videoLoading && hasEmbed && (
                  <div
                    className="w-full flex justify-center"
                    dangerouslySetInnerHTML={{ __html: videoData.embed_html }}
                  />
                )}

                {!videoLoading && !hasVideo && !hasEmbed && hasThumbnail && (
                  <div className="text-center">
                    <img
                      ref={imageRef}
                      src={displayThumbnail}
                      alt="Ad thumbnail"
                      decoding="async"
                      onLoad={handleImageLoad}
                      className="w-full h-auto max-h-[80vh] object-contain rounded-xl"
                    />
                    <p className="mt-3 text-sm text-gray-600">
                      {showPermissionFallback ? "Can't play this video here." : 'Playable video source unavailable.'}
                    </p>
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

            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
              {downloadProxyUrl && (
                <a
                  href={downloadProxyUrl}
                  className="px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Download MP4
                </a>
              )}
              {videoData?.permalink_url && (
                <button
                  onClick={() => window.open(videoData.permalink_url, '_blank')}
                  className="px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                >
                  Open on Facebook
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
