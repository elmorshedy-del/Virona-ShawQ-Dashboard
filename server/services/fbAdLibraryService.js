// server/services/fbAdLibraryService.js
// Facebook Ad Library API Integration

import axios from 'axios';
import { getMetaAccessToken, updateMetaApiStatus } from './metaAuthService.js';

const FB_API_VERSION = 'v21.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeParams(params) {
  if (!params) return {};
  const { access_token: _accessToken, ...rest } = params;
  return rest;
}

function shouldRetryOAuth(error) {
  const metaError = error.response?.data?.error;
  return metaError?.type === 'OAuthException' && metaError?.code === 1;
}

function extractFbTraceId(error) {
  return error.response?.data?.error?.fbtrace_id
    || error.response?.headers?.['x-fb-trace-id']
    || null;
}

async function requestAdLibrary({ params, requestLabel, path = '/ads_archive' }) {
  const { token, expired } = getMetaAccessToken();

  if (!token) {
    const errorMessage = expired
      ? 'Meta user token expired. Reconnect to continue.'
      : 'Meta user token not connected. Connect Meta to continue.';
    const error = new Error(errorMessage);
    error.code = 'META_AUTH_MISSING';
    throw error;
  }

  const requestParams = { ...params, access_token: token };
  const safeParams = sanitizeParams(requestParams);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(`${FB_API_BASE}${path}`, {
        params: requestParams,
        timeout: 30000
      });

      updateMetaApiStatus({ status: response.status, fbtraceId: null });
      return response;
    } catch (error) {
      const status = error.response?.status ?? 500;
      const fbtraceId = extractFbTraceId(error);

      updateMetaApiStatus({ status, fbtraceId });

      console.error('[Meta Ad Library] Request failed', {
        requestLabel,
        status,
        fbtrace_id: fbtraceId,
        params: safeParams,
        message: error.response?.data?.error?.message || error.message
      });

      if (shouldRetryOAuth(error) && attempt < MAX_RETRIES) {
        await delay(RETRY_BACKOFF_MS * Math.pow(2, attempt));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Failed to reach Meta Ad Library');
}

// ============================================================================
// SEARCH ADS BY BRAND NAME
// ============================================================================
async function searchByBrand(brandName, options = {}) {
  const {
    country = 'SA',
    limit = 25,
    activeOnly = true
  } = options;

  try {
    const response = await requestAdLibrary({
      requestLabel: 'searchByBrand',
      params: {
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

    if (error.code === 'META_AUTH_MISSING') {
      throw error;
    }
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

  try {
    const response = await requestAdLibrary({
      requestLabel: 'searchByPageId',
      params: {
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
  try {
    const response = await requestAdLibrary({
      requestLabel: 'getAdDetails',
      path: `/${adArchiveId}`,
      params: {
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
