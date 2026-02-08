import { useEffect, useState } from 'react';
import { Rocket, Users, Image as ImageIcon, CheckCircle, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';

const API_BASE = '/api';
const CAMPAIGN_LAUNCHER_API_KEY = import.meta.env.VITE_META_CAMPAIGN_LAUNCHER_API_KEY || '';

const OBJECTIVES = [
  { id: 'OUTCOME_SALES', label: 'Sales', desc: 'Drive conversions and sales', icon: '💰' },
  { id: 'OUTCOME_TRAFFIC', label: 'Traffic', desc: 'Send people to your website', icon: '🚦' },
  { id: 'OUTCOME_AWARENESS', label: 'Awareness', desc: 'Show ads to people most likely to remember them', icon: '📢' }
];

const CTA_OPTIONS = [
  { id: 'SHOP_NOW', label: 'Shop Now' },
  { id: 'LEARN_MORE', label: 'Learn More' },
  { id: 'SIGN_UP', label: 'Sign Up' },
  { id: 'CONTACT_US', label: 'Contact Us' }
];

const STORE_DEFAULTS = {
  vironax: { country: 'SA', linkUrl: 'https://vironax.com' },
  shawq: { country: 'US', linkUrl: 'https://shawq.com' }
};

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { error: text };
  }
}

function getStoreDefaults(storeId) {
  return STORE_DEFAULTS[storeId] || STORE_DEFAULTS.shawq;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read selected image file'));
    reader.readAsDataURL(file);
  });
}

export default function CampaignLauncher({ store }) {
  const storeId = store?.id || 'vironax';
  const defaultConfig = getStoreDefaults(storeId);
  const defaultCountry = defaultConfig.country;
  const defaultLinkUrl = defaultConfig.linkUrl;

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState(null);
  const [result, setResult] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [adAccounts, setAdAccounts] = useState([]);
  const [pages, setPages] = useState([]);

  const [formData, setFormData] = useState(() => ({
    adAccountId: '',
    campaignName: `New Campaign - ${new Date().toISOString().split('T')[0]}`,
    objective: 'OUTCOME_SALES',
    dailyBudget: 50,
    country: defaultCountry,
    ageMin: 18,
    ageMax: 65,
    gender: [1, 2], // 1=Male, 2=Female
    pageId: '',
    adName: 'Ad 1',
    primaryText: '',
    headline: '',
    description: '',
    linkUrl: defaultLinkUrl,
    cta: 'SHOP_NOW',
    imageUrl: '',
    imageFile: null,
    imagePreviewUrl: null
  }));

  useEffect(() => {
    let isCancelled = false;

    const loadMetaResources = async () => {
      setResourcesLoading(true);
      setResourcesError(null);

      try {
        const [accountsResponse, pagesResponse] = await Promise.all([
          fetch(`${API_BASE}/meta/adaccounts?store=${encodeURIComponent(storeId)}`),
          fetch(`${API_BASE}/meta/pages?store=${encodeURIComponent(storeId)}`)
        ]);

        const [accountsPayload, pagesPayload] = await Promise.all([
          readJsonResponse(accountsResponse),
          readJsonResponse(pagesResponse)
        ]);

        if (!accountsResponse.ok) {
          throw new Error(accountsPayload?.error || `Failed to load ad accounts (HTTP ${accountsResponse.status})`);
        }
        if (!pagesResponse.ok) {
          throw new Error(pagesPayload?.error || `Failed to load pages (HTTP ${pagesResponse.status})`);
        }

        const nextAccounts = Array.isArray(accountsPayload?.data) ? accountsPayload.data : [];
        const nextPages = Array.isArray(pagesPayload?.data) ? pagesPayload.data : [];

        if (isCancelled) return;

        setAdAccounts(nextAccounts);
        setPages(nextPages);

        setFormData((prev) => ({
          ...prev,
          adAccountId: nextAccounts.some((account) => account.id === prev.adAccountId)
            ? prev.adAccountId
            : (nextAccounts[0]?.id || ''),
          pageId: nextPages.some((page) => page.id === prev.pageId)
            ? prev.pageId
            : (nextPages[0]?.id || '')
        }));
      } catch (loadError) {
        if (isCancelled) return;

        setAdAccounts([]);
        setPages([]);
        setResourcesError(loadError?.message || 'Failed to load Meta resources');
        setFormData((prev) => ({ ...prev, adAccountId: '', pageId: '' }));
      } finally {
        if (!isCancelled) {
          setResourcesLoading(false);
        }
      }
    };

    loadMetaResources();

    return () => {
      isCancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      country: defaultCountry,
      linkUrl: defaultLinkUrl
    }));
  }, [defaultCountry, defaultLinkUrl]);

  useEffect(() => {
    return () => {
      if (formData.imagePreviewUrl) URL.revokeObjectURL(formData.imagePreviewUrl);
    };
  }, [formData.imagePreviewUrl]);

  const setImageFile = (file) => {
    setFormData((prev) => {
      if (prev.imagePreviewUrl) URL.revokeObjectURL(prev.imagePreviewUrl);
      const previewUrl = file ? URL.createObjectURL(file) : null;
      return { ...prev, imageFile: file, imagePreviewUrl: previewUrl };
    });
  };

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!formData.campaignName.trim()) throw new Error('Campaign name is required');
      if (!formData.adAccountId) throw new Error('Please select an ad account');
      if (!formData.pageId) throw new Error('Please select a page');
      if (!formData.linkUrl.trim()) throw new Error('Destination URL is required');

      let imageBase64;
      let imageFilename;
      if (formData.imageFile) {
        imageBase64 = await fileToBase64(formData.imageFile);
        imageFilename = formData.imageFile.name;
      }

      const payload = {
        store: storeId,
        adAccountId: formData.adAccountId,
        campaignName: formData.campaignName.trim(),
        objective: formData.objective,
        dailyBudget: Number(formData.dailyBudget),
        country: formData.country,
        ageMin: Number(formData.ageMin),
        ageMax: Number(formData.ageMax),
        gender: formData.gender,
        pageId: formData.pageId,
        adName: formData.adName.trim(),
        primaryText: formData.primaryText.trim(),
        headline: formData.headline.trim(),
        description: formData.description.trim(),
        linkUrl: formData.linkUrl.trim(),
        cta: formData.cta,
        imageUrl: formData.imageUrl.trim() || undefined,
        imageBase64,
        imageFilename
      };

      const requestHeaders = { 'Content-Type': 'application/json' };
      if (CAMPAIGN_LAUNCHER_API_KEY) {
        requestHeaders['X-Meta-Launcher-Key'] = CAMPAIGN_LAUNCHER_API_KEY;
      }

      const response = await fetch(`${API_BASE}/meta/campaign-launcher`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload)
      });

      const data = await readJsonResponse(response);
      if (!response.ok) {
        const stepLabel = data?.step ? ` (${data.step})` : '';
        throw new Error(`${data?.error || `Failed to create campaign (HTTP ${response.status})`}${stepLabel}`);
      }

      setWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
      setResult(data);
      setStep(4);
    } catch (launchError) {
      setError(launchError?.message || 'Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <div className="space-y-6 animate-fade-in">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account</label>
        <select
          value={formData.adAccountId}
          onChange={(e) => setFormData((prev) => ({ ...prev, adAccountId: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          disabled={resourcesLoading || adAccounts.length === 0}
        >
          <option value="">Select an ad account</option>
          {adAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name || account.id}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {resourcesLoading
            ? 'Loading connected ad accounts...'
            : adAccounts.length > 0
              ? 'Choose where this campaign will be created in Meta.'
              : 'No ad accounts available for this store. Check Meta credentials.'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
        <input
          type="text"
          value={formData.campaignName}
          onChange={(e) => setFormData((prev) => ({ ...prev, campaignName: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {OBJECTIVES.map((obj) => (
          <button
            type="button"
            key={obj.id}
            onClick={() => setFormData((prev) => ({ ...prev, objective: obj.id }))}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              formData.objective === obj.id
                ? 'border-indigo-600 bg-indigo-50'
                : 'border-gray-200 hover:border-indigo-200'
            }`}
          >
            <div className="text-2xl mb-2">{obj.icon}</div>
            <div className="font-semibold text-gray-900">{obj.label}</div>
            <div className="text-xs text-gray-500 mt-1">{obj.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Daily Budget ({store?.currency || 'USD'})</label>
          <input
            type="number"
            min={1}
            value={formData.dailyBudget}
            onChange={(e) => setFormData((prev) => ({ ...prev, dailyBudget: e.target.value === '' ? '' : Number(e.target.value) }))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
          <select
            value={formData.country}
            onChange={(e) => setFormData((prev) => ({ ...prev, country: e.target.value }))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="SA">Saudi Arabia</option>
            <option value="US">United States</option>
            <option value="TR">Turkey</option>
            <option value="AE">UAE</option>
          </select>
        </div>
      </div>

      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
          <Users className="w-4 h-4" /> Audience Targeting
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500">Age Range</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min={13}
                max={65}
                value={formData.ageMin}
                onChange={(e) => setFormData((prev) => ({ ...prev, ageMin: parseInt(e.target.value, 10) || 0 }))}
                className="w-20 px-2 py-1 border rounded"
              />
              <span>to</span>
              <input
                type="number"
                min={13}
                max={65}
                value={formData.ageMax}
                onChange={(e) => setFormData((prev) => ({ ...prev, ageMax: parseInt(e.target.value, 10) || 0 }))}
                className="w-20 px-2 py-1 border rounded"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">Gender</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, gender: [1, 2] }))}
                className={`px-3 py-1 text-sm rounded ${
                  formData.gender.length === 2 ? 'bg-indigo-600 text-white' : 'bg-white border'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, gender: [1] }))}
                className={`px-3 py-1 text-sm rounded ${
                  formData.gender.length === 1 && formData.gender[0] === 1
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border'
                }`}
              >
                Men
              </button>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, gender: [2] }))}
                className={`px-3 py-1 text-sm rounded ${
                  formData.gender.length === 1 && formData.gender[0] === 2
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border'
                }`}
              >
                Women
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6 animate-fade-in">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Facebook Page</label>
        <select
          value={formData.pageId}
          onChange={(e) => setFormData((prev) => ({ ...prev, pageId: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          disabled={resourcesLoading || pages.length === 0}
        >
          <option value="">Select a page</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {resourcesLoading
            ? 'Loading connected pages...'
            : pages.length > 0
              ? 'These pages are pulled from your Meta Business integration.'
              : 'No pages found. Ensure your token has pages permissions.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ad Name</label>
            <input
              type="text"
              value={formData.adName}
              onChange={(e) => setFormData((prev) => ({ ...prev, adName: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Primary Text</label>
            <textarea
              rows={3}
              value={formData.primaryText}
              onChange={(e) => setFormData((prev) => ({ ...prev, primaryText: e.target.value }))}
              placeholder="The main text of your ad..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Headline</label>
            <input
              type="text"
              value={formData.headline}
              onChange={(e) => setFormData((prev) => ({ ...prev, headline: e.target.value }))}
              placeholder="Catchy headline"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Destination URL</label>
            <input
              type="text"
              value={formData.linkUrl}
              onChange={(e) => setFormData((prev) => ({ ...prev, linkUrl: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Optional Image URL</label>
            <input
              type="text"
              value={formData.imageUrl}
              onChange={(e) => setFormData((prev) => ({ ...prev, imageUrl: e.target.value }))}
              placeholder="https://example.com/ad-image.jpg"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Call To Action</label>
            <select
              value={formData.cta}
              onChange={(e) => setFormData((prev) => ({ ...prev, cta: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {CTA_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-gray-50 flex flex-col items-center justify-center text-center">
          <div className="w-full aspect-video bg-gray-200 rounded-lg flex items-center justify-center mb-3 overflow-hidden">
            {formData.imagePreviewUrl ? (
              <img src={formData.imagePreviewUrl} alt="Selected creative" className="w-full h-full object-cover" />
            ) : (
              <>
                <ImageIcon className="w-8 h-8 text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Image Placeholder</span>
              </>
            )}
          </div>
          <div className="w-full">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
            <p className="text-xs text-gray-500 mt-2">
              If selected, the image is uploaded directly to Meta as part of launch.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSuccess = () => (
    <div className="text-center py-12 animate-fade-in">
      <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="w-8 h-8" />
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-2">Campaign Created</h3>
      <p className="text-gray-600 mb-6">
        <strong>{formData.campaignName}</strong> was created successfully in Meta and left paused for safe review.
      </p>
      <div className="bg-gray-50 rounded-lg p-4 max-w-xl mx-auto text-left text-sm font-mono text-gray-600 mb-6 space-y-1">
        <p>Campaign ID: {result?.campaign_id}</p>
        <p>Ad Set ID: {result?.adset_id}</p>
        <p>Creative ID: {result?.creative_id}</p>
        <p>Ad ID: {result?.ad_id}</p>
      </div>
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 max-w-xl mx-auto text-left text-sm text-amber-800 mb-6">
          {warnings.map((warning) => (
            <p key={warning}>• {warning}</p>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setStep(1);
          setResult(null);
          setWarnings([]);
          setError(null);
        }}
        className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
      >
        Create Another
      </button>
    </div>
  );

  if (step === 4) return renderSuccess();

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-900 text-white p-6 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Rocket className="w-5 h-5" /> Campaign Launcher
          </h2>
          <p className="text-indigo-200 text-sm mt-1">Live Meta wizard (campaign + ad set + creative + ad)</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`px-3 py-1 rounded-full ${step >= 1 ? 'bg-indigo-500' : 'bg-gray-700'}`}>1. Strategy</span>
          <div className="w-4 h-0.5 bg-gray-700" />
          <span className={`px-3 py-1 rounded-full ${step >= 2 ? 'bg-indigo-500' : 'bg-gray-700'}`}>2. Audience</span>
          <div className="w-4 h-0.5 bg-gray-700" />
          <span className={`px-3 py-1 rounded-full ${step >= 3 ? 'bg-indigo-500' : 'bg-gray-700'}`}>3. Creative</span>
        </div>
      </div>

      <div className="p-8 min-h-[400px]">
        {resourcesError && (
          <div className="mb-6 p-4 bg-amber-50 text-amber-800 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> {resourcesError}
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> {error}
          </div>
        )}

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>

      <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || loading}
          className="px-6 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded-lg disabled:opacity-50"
        >
          Back
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={loading || (step === 1 && (!formData.adAccountId || !formData.campaignName.trim()))}
            className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-70"
          >
            Next Step <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleLaunch}
            disabled={loading || resourcesLoading}
            className="px-8 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-70"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Launch Campaign
          </button>
        )}
      </div>
    </div>
  );
}
