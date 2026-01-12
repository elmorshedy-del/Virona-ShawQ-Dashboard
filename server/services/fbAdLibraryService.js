// server/services/fbAdLibraryService.js
// Facebook Ad Library API Integration

import axios from 'axios';
import { getMetaAccessToken, recordMetaAuthCall } from './metaAuthService.js';

const FB_API_VERSION = 'v21.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// ============================================================================
// SEARCH ADS BY BRAND NAME
// ============================================================================
const RETRYABLE_OAUTH_CODE = 1;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 600;

function sanitizeParams(params) {
  const sanitized = { ...params };
  if ('access_token' in sanitized) {
    sanitized.access_token = '[REDACTED]';
  }
  return sanitized;
}

function isRetryableOauthError(error) {
  const metaError = error?.response?.data?.error;
  return metaError?.type === 'OAuthException' && Number(metaError?.code) === RETRYABLE_OAUTH_CODE;
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function requestAdLibrary({ params, requestLabel, path = '/ads_archive' }) {
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.get(`${FB_API_BASE}${path}`, {
        params,
        timeout: 30000
      });

      recordMetaAuthCall({ status: 'success' });
      return response;
    } catch (error) {
      const retryable = isRetryableOauthError(error);
      const metaError = error?.response?.data?.error;
      const fbtraceId = metaError?.fbtrace_id;

      if (retryable && attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        attempt += 1;
        await sleep(delay);
        continue;
      }

      recordMetaAuthCall({
        status: 'error',
        errorMessage: metaError?.message || error.message,
        fbtraceId
      });

      console.error('[FB Ad Library] Request failed:', {
        label: requestLabel,
        fbtrace_id: fbtraceId,
        params: sanitizeParams(params),
        error: metaError || error.message
      });

      throw error;
    }
  }
}

async function searchByBrand(brandName, options = {}) {
  const {
    country = 'SA',
    limit = 25,
    activeOnly = true
  } = options;

  const accessToken = getMetaAccessToken();

  if (!accessToken) {
    throw new Error('Meta user access token not configured');
  }

  try {
    const response = await requestAdLibrary({
      requestLabel: 'searchByBrand',
      params: {
        access_token: accessToken,
        search_terms: brandName,
        ad_reached_countries: JSON.stringify([country]),
        ad_active_status: activeOnly ? 'ACTIVE' : 'ALL',
        ad_type: 'ALL',
        fields: [
          'id',
          'ad_creative_bodies',
          'ad_creative_link_captions',
          'ad_creative_link_descriptions',
          'ad_creative_link_titles',
          'ad_delivery_start_time',
          'ad_delivery_stop_time',
          'ad_snapshot_url',
          'bylines',
          'currency',
          'impressions',
          'page_id',
          'page_name',
          'publisher_platforms',
          'spend'
        ].join(','),
        limit
      }
    });

    if (!response.data || !response.data.data) {
      return [];
    }

    return response.data.data.map(ad => ({
      id: ad.id,
      page_name: ad.page_name,
      page_id: ad.page_id,
      copy: ad.ad_creative_bodies?.[0] || '',
      headline: ad.ad_creative_link_titles?.[0] || '',
      description: ad.ad_creative_link_descriptions?.[0] || '',
      caption: ad.ad_creative_link_captions?.[0] || '',
      start_date: ad.ad_delivery_start_time,
      end_date: ad.ad_delivery_stop_time,
      snapshot_url: ad.ad_snapshot_url,
      platforms: ad.publisher_platforms || [],
      impressions: parseImpressions(ad.impressions),
      spend: parseSpend(ad.spend),
      currency: ad.currency,
      bylines: ad.bylines
    }));

  } catch (error) {
    console.error('FB Ad Library API error:', error.response?.data || error.message);

    if (error.response?.status === 400) {
      throw new Error('Invalid search parameters');
    }
    if (error.response?.status === 403) {
      throw new Error('Ad Library API access denied. Check permissions.');
    }

    throw new Error('Failed to search Ad Library');
  }
}

// ============================================================================
// SEARCH BY PAGE ID
// ============================================================================
async function searchByPageId(pageId, options = {}) {
  const {
    country = 'SA',
    limit = 50,
    activeOnly = true
  } = options;

  const accessToken = getMetaAccessToken();

  if (!accessToken) {
    throw new Error('Meta user access token not configured');
  }

  try {
    const response = await requestAdLibrary({
      requestLabel: 'searchByPageId',
      params: {
        access_token: accessToken,
        search_page_ids: JSON.stringify([pageId]),
        ad_reached_countries: JSON.stringify([country]),
        ad_active_status: activeOnly ? 'ACTIVE' : 'ALL',
        fields: [
          'id',
          'ad_creative_bodies',
          'ad_creative_link_titles',
          'ad_delivery_start_time',
          'ad_snapshot_url',
          'page_name',
          'publisher_platforms'
        ].join(','),
        limit
      }
    });

    if (!response.data || !response.data.data) {
      return [];
    }

    return response.data.data.map(ad => ({
      id: ad.id,
      page_name: ad.page_name,
      copy: ad.ad_creative_bodies?.[0] || '',
      headline: ad.ad_creative_link_titles?.[0] || '',
      start_date: ad.ad_delivery_start_time,
      snapshot_url: ad.ad_snapshot_url,
      platforms: ad.publisher_platforms || []
    }));

  } catch (error) {
    console.error('FB Ad Library search by page error:', error.response?.data || error.message);
    throw new Error('Failed to search Ad Library by page');
  }
}

// ============================================================================
// GET AD DETAILS
// ============================================================================
async function getAdDetails(adArchiveId) {
  const accessToken = getMetaAccessToken();

  if (!accessToken) {
    throw new Error('Meta user access token not configured');
  }

  try {
    const response = await requestAdLibrary({
      requestLabel: 'getAdDetails',
      path: `/${adArchiveId}`,
      params: {
        access_token: accessToken,
        fields: [
          'id',
          'ad_creative_bodies',
          'ad_creative_link_captions',
          'ad_creative_link_descriptions',
          'ad_creative_link_titles',
          'ad_delivery_start_time',
          'ad_delivery_stop_time',
          'ad_snapshot_url',
          'bylines',
          'currency',
          'demographic_distribution',
          'impressions',
          'page_id',
          'page_name',
          'potential_reach',
          'publisher_platforms',
          'region_distribution',
          'spend'
        ].join(',')
      }
    });

    return response.data;

  } catch (error) {
    console.error('Get ad details error:', error.response?.data || error.message);
    throw new Error('Failed to get ad details');
  }
}

// ============================================================================
// GET COUNTRY CODES FOR AD LIBRARY
// ============================================================================
function getSupportedCountries() {
  return {
    'SA': 'Saudi Arabia',
    'AE': 'United Arab Emirates',
    'KW': 'Kuwait',
    'QA': 'Qatar',
    'BH': 'Bahrain',
    'OM': 'Oman',
    'EG': 'Egypt',
    'JO': 'Jordan',
    'LB': 'Lebanon',
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'TR': 'Turkey'
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function parseImpressions(impressions) {
  if (!impressions) return null;

  // Facebook returns impressions as a range like { lower_bound: "1000", upper_bound: "5000" }
  if (typeof impressions === 'object') {
    const lower = parseInt(impressions.lower_bound) || 0;
    const upper = parseInt(impressions.upper_bound) || 0;
    return {
      lower: lower,
      upper: upper,
      estimate: Math.round((lower + upper) / 2)
    };
  }

  return null;
}

function parseSpend(spend) {
  if (!spend) return null;

  // Facebook returns spend as a range
  if (typeof spend === 'object') {
    const lower = parseInt(spend.lower_bound) || 0;
    const upper = parseInt(spend.upper_bound) || 0;
    return {
      lower: lower,
      upper: upper,
      estimate: Math.round((lower + upper) / 2)
    };
  }

  return null;
}

// ============================================================================
// BATCH SEARCH MULTIPLE BRANDS
// ============================================================================
async function searchMultipleBrands(brandNames, options = {}) {
  const results = {};

  for (const brand of brandNames) {
    try {
      results[brand] = await searchByBrand(brand, options);
      // Rate limiting - wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to search brand ${brand}:`, error.message);
      results[brand] = { error: error.message };
    }
  }

  return results;
}

export {
  searchByBrand,
  searchByPageId,
  getAdDetails,
  getSupportedCountries,
  searchMultipleBrands
};
