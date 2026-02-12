// server/services/fatigueService.js
// Creative Fatigue & Audience Saturation Detection Service
// Uses statistical analysis to distinguish between creative fatigue and audience saturation

import { getDb } from '../db/database.js';

const DEFAULT_LOOKBACK_DAYS = 30;
const ADSET_STATUS_PRIORITY = {
  saturated: 0,
  fatigued: 1,
  warning: 2,
  healthy: 3
};
const ACTIVE_CAMPAIGN_STATUS_SQL_FILTER = `
  AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)
`;

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function toStatus(value) {
  if (!value || typeof value !== 'string') return 'UNKNOWN';
  return value.toUpperCase();
}

function getLinkClicks(inlineLinkClicks, outboundClicks) {
  const inlineClicks = Number(inlineLinkClicks) || 0;
  const outbound = Number(outboundClicks) || 0;
  return inlineClicks > 0 ? inlineClicks : Math.max(0, outbound);
}

function getLinkCtr(impressions, inlineLinkClicks, outboundClicks) {
  const totalImpressions = Number(impressions) || 0;
  if (totalImpressions <= 0) return 0;
  return (getLinkClicks(inlineLinkClicks, outboundClicks) / totalImpressions) * 100;
}

function buildCampaignHierarchy(adSets) {
  const campaignMap = new Map();

  for (const adSet of adSets) {
    const campaignKey = adSet.campaign_id || `campaign:${adSet.campaign_name || 'unknown'}`;
    if (!campaignMap.has(campaignKey)) {
      campaignMap.set(campaignKey, {
        campaign_id: adSet.campaign_id || null,
        campaign_name: adSet.campaign_name || 'Unnamed Campaign',
        effective_status: toStatus(adSet.campaign_effective_status),
        isActive: toStatus(adSet.campaign_effective_status) === 'ACTIVE',
        adSets: [],
        summary: { total: 0, healthy: 0, warning: 0, fatigued: 0, saturated: 0 }
      });
    }

    const campaign = campaignMap.get(campaignKey);
    campaign.adSets.push(adSet);
    campaign.summary.total += 1;
    if (Object.prototype.hasOwnProperty.call(campaign.summary, adSet.status)) {
      campaign.summary[adSet.status] += 1;
    }
  }

  return Array.from(campaignMap.values())
    .map((campaign) => ({
      ...campaign,
      adSets: [...campaign.adSets].sort(
        (a, b) =>
          (ADSET_STATUS_PRIORITY[a.status] ?? ADSET_STATUS_PRIORITY.healthy) -
          (ADSET_STATUS_PRIORITY[b.status] ?? ADSET_STATUS_PRIORITY.healthy)
      )
    }))
    .sort((a, b) => {
      const activeDiff = Number(b.isActive) - Number(a.isActive);
      if (activeDiff !== 0) return activeDiff;
      return (a.campaign_name || '').localeCompare(b.campaign_name || '');
    });
}

// ============================================================================
// STATISTICAL FUNCTIONS
// ============================================================================

/**
 * Calculate Pearson correlation coefficient
 * r = 1: perfect positive correlation
 * r = -1: perfect negative correlation  
 * r = 0: no correlation
 */
function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return { r: 0, valid: false };
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return { r: 0, valid: false };
  
  return { r: numerator / denominator, valid: true };
}

/**
 * Calculate p-value for correlation coefficient using t-distribution approximation
 * Lower p-value = more statistically significant
 */
function correlationPValue(r, n) {
  if (n < 3 || Math.abs(r) >= 1) return 1;
  
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const df = n - 2;
  
  // Approximation of two-tailed t-test p-value
  // Using the approximation: p ≈ 2 * (1 - Φ(|t| * √(df/(df-2+t²))))
  const x = Math.abs(t);
  const a = df / (df + x * x);
  
  // Beta function approximation for incomplete beta
  let p;
  if (df > 100) {
    // Normal approximation for large df
    p = 2 * (1 - normalCDF(x));
  } else {
    // Simpler approximation
    p = Math.pow(a, df / 2);
  }
  
  return Math.min(1, Math.max(0, p));
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate linear regression slope (trend direction)
 * Positive = increasing, Negative = decreasing
 */
function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * values[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  
  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Calculate percentage change
 */
function percentChange(oldVal, newVal) {
  if (oldVal === 0) return newVal > 0 ? 100 : 0;
  return ((newVal - oldVal) / oldVal) * 100;
}

/**
 * Calculate average pairwise correlation between multiple time series
 * High correlation = series move together (saturation signal)
 */
function avgPairwiseCorrelation(seriesArray) {
  if (seriesArray.length < 2) return 0;
  
  let totalCorr = 0;
  let count = 0;
  
  for (let i = 0; i < seriesArray.length; i++) {
    for (let j = i + 1; j < seriesArray.length; j++) {
      const { r, valid } = pearsonCorrelation(seriesArray[i], seriesArray[j]);
      if (valid) {
        totalCorr += r;
        count++;
      }
    }
  }
  
  return count > 0 ? totalCorr / count : 0;
}

// ============================================================================
// MAIN ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Get fatigue analysis for all ad sets in a store
 */
export function getFatigueAnalysis(store, params = {}) {
  const db = getDb();
const days = Math.min(90, Math.max(7, parseInt(params.days, 10) || DEFAULT_LOOKBACK_DAYS));
  const includeInactive = isTruthy(params.includeInactive);
  
  // Calculate date range
  const endDate = params.endDate || new Date().toISOString().split('T')[0];
  const startDate = params.startDate || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const statusFilter = includeInactive ? '' : ACTIVE_CAMPAIGN_STATUS_SQL_FILTER;
  
  // Get all ad sets with their ads
  const adSetData = db.prepare(`
    SELECT 
      campaign_id,
      campaign_name,
      MAX(effective_status) as campaign_effective_status,
      adset_id,
      adset_name,
      ad_id,
      ad_name,
      date,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(inline_link_clicks) as inline_link_clicks,
      SUM(outbound_clicks) as outbound_clicks,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(spend) as spend
    FROM meta_ad_metrics
    WHERE store = ? 
      AND date BETWEEN ? AND ?
      AND adset_id IS NOT NULL
      AND ad_id IS NOT NULL
      ${statusFilter}
    GROUP BY campaign_id, campaign_name, adset_id, ad_id, date
    ORDER BY campaign_name, adset_name, ad_id, date
  `).all(store, startDate, endDate);
  
  if (!adSetData.length) {
    return {
      success: true,
      summary: { total: 0, healthy: 0, warning: 0, fatigued: 0, saturated: 0 },
      adSets: [],
      campaigns: [],
      includeInactive,
      ctrDefinition: 'link_ctr = link_clicks / impressions',
      dateRange: { start: startDate, end: endDate }
    };
  }
  
  // Group by ad set
  const adSetMap = new Map();
  
  for (const row of adSetData) {
    if (!adSetMap.has(row.adset_id)) {
      adSetMap.set(row.adset_id, {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        campaign_effective_status: toStatus(row.campaign_effective_status),
        adset_id: row.adset_id,
        adset_name: row.adset_name,
        ads: new Map()
      });
    }
    
    const adSet = adSetMap.get(row.adset_id);
    
    if (!adSet.ads.has(row.ad_id)) {
      adSet.ads.set(row.ad_id, {
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        daily: []
      });
    }
    
    const ad = adSet.ads.get(row.ad_id);
    const linkClicks = getLinkClicks(row.inline_link_clicks, row.outbound_clicks);
    const ctr = getLinkCtr(row.impressions, row.inline_link_clicks, row.outbound_clicks);
    const cvr = linkClicks > 0 ? (row.conversions / linkClicks) * 100 : 0;
    const frequency = row.reach > 0 ? row.impressions / row.reach : 0;
    const newReachRatio = row.impressions > 0 ? row.reach / row.impressions : 0;
    
    ad.daily.push({
      date: row.date,
      impressions: row.impressions,
      reach: row.reach,
      clicks: linkClicks,
      rawClicks: row.clicks,
      inlineLinkClicks: row.inline_link_clicks,
      outboundClicks: row.outbound_clicks,
      conversions: row.conversions,
      spend: row.spend,
      ctr,
      cvr,
      frequency,
      newReachRatio
    });
  }
  
  // Analyze each ad set
  const analyzedAdSets = [];
  let summary = { total: 0, healthy: 0, warning: 0, fatigued: 0, saturated: 0 };
  
  for (const [adsetId, adSet] of adSetMap) {
    const adsArray = Array.from(adSet.ads.values());
    
    // Need at least 7 days of data for meaningful analysis
    const validAds = adsArray.filter(ad => ad.daily.length >= 7);
    
    if (validAds.length === 0) continue;
    
    // Analyze each ad
    const adAnalyses = validAds.map(ad => analyzeAd(ad));
    
    // Detect saturation at ad set level
    const saturationAnalysis = detectSaturation(validAds, adAnalyses);
    
    // Determine final diagnosis for each ad
    const finalAdAnalyses = adAnalyses.map(analysis => {
      return determineFinalDiagnosis(analysis, saturationAnalysis);
    });
    
    // Determine ad set status
    const adSetStatus = determineAdSetStatus(finalAdAnalyses, saturationAnalysis);
    
    summary.total++;
    summary[adSetStatus.status]++;
    
    analyzedAdSets.push({
      campaign_id: adSet.campaign_id,
      campaign_name: adSet.campaign_name,
      campaign_effective_status: adSet.campaign_effective_status,
      adset_id: adsetId,
      adset_name: adSet.adset_name,
      status: adSetStatus.status,
      statusLabel: adSetStatus.label,
      diagnosis: adSetStatus.diagnosis,
      recommendation: adSetStatus.recommendation,
      confidence: adSetStatus.confidence,
      saturation: saturationAnalysis,
      ads: finalAdAnalyses.map(a => ({
        ad_id: a.ad_id,
        ad_name: a.ad_name,
        status: a.finalStatus,
        diagnosis: a.finalDiagnosis,
        confidence: a.confidence,
        metrics: a.metrics,
        correlation: a.correlation,
        trends: a.trends,
        daily: a.daily
      }))
    });
  }
  
  // Sort by status priority (fatigued/saturated first)
  analyzedAdSets.sort(
    (a, b) =>
      (ADSET_STATUS_PRIORITY[a.status] ?? ADSET_STATUS_PRIORITY.healthy) -
      (ADSET_STATUS_PRIORITY[b.status] ?? ADSET_STATUS_PRIORITY.healthy)
  );

  const campaigns = buildCampaignHierarchy(analyzedAdSets);
  
  return {
    success: true,
    summary,
    adSets: analyzedAdSets,
    campaigns,
    includeInactive,
    ctrDefinition: 'link_ctr = link_clicks / impressions',
    dateRange: { start: startDate, end: endDate }
  };
}

/**
 * Analyze a single ad for fatigue signals
 */
function analyzeAd(ad) {
  const daily = ad.daily;
  const n = daily.length;
  
  // Extract time series
  const frequencies = daily.map(d => d.frequency);
  const ctrs = daily.map(d => d.ctr);
  const cvrs = daily.map(d => d.cvr);
  const newReachRatios = daily.map(d => d.newReachRatio);
  
  // Calculate correlations
  const freqCtrCorr = pearsonCorrelation(frequencies, ctrs);
  const freqCvrCorr = pearsonCorrelation(frequencies, cvrs);
  
  // Calculate p-values
  const pValueCtr = freqCtrCorr.valid ? correlationPValue(freqCtrCorr.r, n) : 1;
  const pValueCvr = freqCvrCorr.valid ? correlationPValue(freqCvrCorr.r, n) : 1;
  
  // Calculate trends (slope per day)
  const ctrSlope = linearSlope(ctrs);
  const cvrSlope = linearSlope(cvrs);
  const freqSlope = linearSlope(frequencies);
  const reachSlope = linearSlope(newReachRatios);
  
  // Calculate period comparisons (first half vs second half)
  const midpoint = Math.floor(n / 2);
  const firstHalf = daily.slice(0, midpoint);
  const secondHalf = daily.slice(midpoint);
  
  const avgCtrFirst = firstHalf.reduce((sum, d) => sum + d.ctr, 0) / firstHalf.length;
  const avgCtrSecond = secondHalf.reduce((sum, d) => sum + d.ctr, 0) / secondHalf.length;
  const avgFreqFirst = firstHalf.reduce((sum, d) => sum + d.frequency, 0) / firstHalf.length;
  const avgFreqSecond = secondHalf.reduce((sum, d) => sum + d.frequency, 0) / secondHalf.length;
  const avgReachFirst = firstHalf.reduce((sum, d) => sum + d.newReachRatio, 0) / firstHalf.length;
  const avgReachSecond = secondHalf.reduce((sum, d) => sum + d.newReachRatio, 0) / secondHalf.length;
  
  // Current values (last 3 days average)
  const recent = daily.slice(-3);
  const currentFreq = recent.reduce((sum, d) => sum + d.frequency, 0) / recent.length;
  const currentCtr = recent.reduce((sum, d) => sum + d.ctr, 0) / recent.length;
  const currentReach = recent.reduce((sum, d) => sum + d.newReachRatio, 0) / recent.length;
  
  // Determine fatigue signals
  const hasFatigueCorrelation = freqCtrCorr.valid && freqCtrCorr.r < -0.5 && pValueCtr < 0.05;
  const ctrDeclining = ctrSlope < 0 && percentChange(avgCtrFirst, avgCtrSecond) < -10;
  const freqRising = freqSlope > 0 && percentChange(avgFreqFirst, avgFreqSecond) > 10;
  
  // Calculate fatigue score (0-1)
  let fatigueScore = 0;
  if (hasFatigueCorrelation) fatigueScore += Math.abs(freqCtrCorr.r) * 0.4;
  if (ctrDeclining) fatigueScore += 0.3;
  if (freqRising) fatigueScore += 0.3;
  
  // Determine preliminary status
  let status, confidence;
  if (fatigueScore >= 0.7 && hasFatigueCorrelation) {
    status = 'fatigued';
    confidence = pValueCtr < 0.01 ? 'high' : 'medium';
  } else if (fatigueScore >= 0.4 || (ctrDeclining && freqRising)) {
    status = 'warning';
    confidence = 'medium';
  } else {
    status = 'healthy';
    confidence = 'high';
  }
  
  return {
    ad_id: ad.ad_id,
    ad_name: ad.ad_name,
    status,
    confidence,
    fatigueScore,
    correlation: {
      frequencyCtr: {
        r: freqCtrCorr.valid ? Math.round(freqCtrCorr.r * 1000) / 1000 : null,
        pValue: Math.round(pValueCtr * 10000) / 10000,
        significant: pValueCtr < 0.05
      },
      frequencyCvr: {
        r: freqCvrCorr.valid ? Math.round(freqCvrCorr.r * 1000) / 1000 : null,
        pValue: Math.round(pValueCvr * 10000) / 10000,
        significant: pValueCvr < 0.05
      }
    },
    trends: {
      ctr: {
        slope: Math.round(ctrSlope * 10000) / 10000,
        direction: ctrSlope > 0.001 ? 'rising' : ctrSlope < -0.001 ? 'falling' : 'stable',
        change: Math.round(percentChange(avgCtrFirst, avgCtrSecond) * 10) / 10
      },
      cvr: {
        slope: Math.round(cvrSlope * 10000) / 10000,
        direction: cvrSlope > 0.001 ? 'rising' : cvrSlope < -0.001 ? 'falling' : 'stable',
        change: Math.round(percentChange(firstHalf.reduce((s, d) => s + d.cvr, 0) / firstHalf.length,
                                         secondHalf.reduce((s, d) => s + d.cvr, 0) / secondHalf.length) * 10) / 10
      },
      frequency: {
        slope: Math.round(freqSlope * 10000) / 10000,
        direction: freqSlope > 0.01 ? 'rising' : freqSlope < -0.01 ? 'falling' : 'stable',
        change: Math.round(percentChange(avgFreqFirst, avgFreqSecond) * 10) / 10,
        current: Math.round(currentFreq * 100) / 100
      },
      newReach: {
        slope: Math.round(reachSlope * 10000) / 10000,
        direction: reachSlope > 0.001 ? 'rising' : reachSlope < -0.001 ? 'falling' : 'stable',
        change: Math.round(percentChange(avgReachFirst, avgReachSecond) * 10) / 10,
        current: Math.round(currentReach * 100)
      }
    },
    metrics: {
      currentCtr: Math.round(currentCtr * 100) / 100,
      currentFrequency: Math.round(currentFreq * 100) / 100,
      currentNewReachPct: Math.round(currentReach * 100),
      dataPoints: n
    },
    daily: daily.map(d => ({
      date: d.date,
      ctr: Math.round(d.ctr * 100) / 100,
      cvr: Math.round(d.cvr * 100) / 100,
      frequency: Math.round(d.frequency * 100) / 100,
      newReachPct: Math.round(d.newReachRatio * 100),
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions
    })),
    ctrTimeSeries: ctrs
  };
}

/**
 * Detect audience saturation at ad set level
 */
function detectSaturation(ads, adAnalyses) {
  const decliningAds = adAnalyses.filter(a => 
    a.trends.ctr.direction === 'falling' && a.trends.ctr.change < -10
  );
  
  const declineRatio = decliningAds.length / adAnalyses.length;
  
  // Calculate cross-correlation of CTR time series
  const ctrSeries = adAnalyses
    .filter(a => a.ctrTimeSeries && a.ctrTimeSeries.length >= 7)
    .map(a => a.ctrTimeSeries);
  
  const crossCorrelation = avgPairwiseCorrelation(ctrSeries);
  
  // Calculate average new reach ratio (current)
  const avgNewReach = adAnalyses.reduce((sum, a) => sum + a.trends.newReach.current, 0) / adAnalyses.length;
  
  // Saturation score
  // - High if most ads declining together AND low new reach
  const saturationScore = (
    (declineRatio * 0.35) +
    (Math.max(0, crossCorrelation) * 0.35) +
    (Math.max(0, (100 - avgNewReach) / 100) * 0.30)
  );
  
  const isSaturated = saturationScore > 0.6 && declineRatio > 0.6;
  
  return {
    score: Math.round(saturationScore * 100) / 100,
    isSaturated,
    declineRatio: Math.round(declineRatio * 100),
    crossCorrelation: Math.round(crossCorrelation * 100) / 100,
    avgNewReachPct: Math.round(avgNewReach),
    decliningCount: decliningAds.length,
    totalCount: adAnalyses.length
  };
}

/**
 * Determine final diagnosis considering saturation context
 */
function determineFinalDiagnosis(adAnalysis, saturationAnalysis) {
  const analysis = { ...adAnalysis };
  
  // If ad shows fatigue signals BUT ad set is saturated, it's likely saturation
  if (analysis.status === 'fatigued' && saturationAnalysis.isSaturated) {
    analysis.finalStatus = 'saturated';
    analysis.finalDiagnosis = 'audience_saturation';
    analysis.confidence = 'high';
  }
  // If ad shows fatigue but others in ad set are healthy, it's creative fatigue
  else if (analysis.status === 'fatigued' && !saturationAnalysis.isSaturated) {
    analysis.finalStatus = 'fatigued';
    analysis.finalDiagnosis = 'creative_fatigue';
  }
  // Warning status
  else if (analysis.status === 'warning') {
    if (saturationAnalysis.isSaturated) {
      analysis.finalStatus = 'warning';
      analysis.finalDiagnosis = 'possible_saturation';
    } else {
      analysis.finalStatus = 'warning';
      analysis.finalDiagnosis = 'possible_fatigue';
    }
  }
  // Healthy
  else {
    analysis.finalStatus = 'healthy';
    analysis.finalDiagnosis = 'healthy';
  }
  
  return analysis;
}

/**
 * Determine overall ad set status
 */
function determineAdSetStatus(adAnalyses, saturationAnalysis) {
  const statuses = adAnalyses.map(a => a.finalStatus);
  const fatigueCount = statuses.filter(s => s === 'fatigued').length;
  const saturatedCount = statuses.filter(s => s === 'saturated').length;
  const warningCount = statuses.filter(s => s === 'warning').length;
  
  if (saturationAnalysis.isSaturated) {
    return {
      status: 'saturated',
      label: 'Audience Saturation',
      diagnosis: 'audience_saturation',
      confidence: 'high',
      recommendation: `All ${saturationAnalysis.decliningCount} of ${saturationAnalysis.totalCount} ads are declining together. New reach is at ${saturationAnalysis.avgNewReachPct}%. Expand your audience or reduce budget - refreshing creatives alone won't help.`
    };
  }
  
  if (fatigueCount > 0) {
    const healthyCount = statuses.filter(s => s === 'healthy').length;
    return {
      status: 'fatigued',
      label: 'Creative Fatigue',
      diagnosis: 'creative_fatigue',
      confidence: healthyCount > 0 ? 'high' : 'medium',
      recommendation: `${fatigueCount} of ${adAnalyses.length} ads showing fatigue signals while others are stable. Refresh the fatigued creatives.`
    };
  }
  
  if (warningCount > 0) {
    return {
      status: 'warning',
      label: 'Early Warning',
      diagnosis: 'early_warning',
      confidence: 'medium',
      recommendation: `${warningCount} ads showing early warning signs. Monitor closely and prepare replacement creatives.`
    };
  }
  
  return {
    status: 'healthy',
    label: 'Healthy',
    diagnosis: 'healthy',
    confidence: 'high',
    recommendation: 'All ads performing within normal parameters. Continue monitoring.'
  };
}

/**
 * Get detailed analysis for a single ad
 */
export function getAdFatigueDetail(store, adId, params = {}) {
  const db = getDb();
  const days = parseInt(params.days, 10) || DEFAULT_LOOKBACK_DAYS;
  
  const endDate = params.endDate || new Date().toISOString().split('T')[0];
  const startDate = params.startDate || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const adData = db.prepare(`
    SELECT 
      ad_id,
      ad_name,
      adset_id,
      adset_name,
      date,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(inline_link_clicks) as inline_link_clicks,
      SUM(outbound_clicks) as outbound_clicks,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(spend) as spend
    FROM meta_ad_metrics
    WHERE store = ? 
      AND ad_id = ?
      AND date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `).all(store, adId, startDate, endDate);
  
  if (!adData.length) {
    return { success: false, error: 'Ad not found or no data' };
  }
  
  // Transform to analysis format
  const ad = {
    ad_id: adData[0].ad_id,
    ad_name: adData[0].ad_name,
    daily: adData.map(row => {
      const linkClicks = getLinkClicks(row.inline_link_clicks, row.outbound_clicks);
      const ctr = getLinkCtr(row.impressions, row.inline_link_clicks, row.outbound_clicks);
      const cvr = linkClicks > 0 ? (row.conversions / linkClicks) * 100 : 0;
      const frequency = row.reach > 0 ? row.impressions / row.reach : 0;
      const newReachRatio = row.impressions > 0 ? row.reach / row.impressions : 0;
      
      return {
        date: row.date,
        impressions: row.impressions,
        reach: row.reach,
        clicks: linkClicks,
        rawClicks: row.clicks,
        inlineLinkClicks: row.inline_link_clicks,
        outboundClicks: row.outbound_clicks,
        conversions: row.conversions,
        spend: row.spend,
        ctr,
        cvr,
        frequency,
        newReachRatio
      };
    })
  };
  
  const analysis = analyzeAd(ad);
  
  // Get sibling ads in same ad set for comparison
  const siblings = db.prepare(`
    SELECT DISTINCT ad_id, ad_name
    FROM meta_ad_metrics
    WHERE store = ? 
      AND adset_id = (SELECT adset_id FROM meta_ad_metrics WHERE ad_id = ? LIMIT 1)
      AND ad_id != ?
      AND date BETWEEN ? AND ?
  `).all(store, adId, adId, startDate, endDate);
  
  return {
    success: true,
    analysis,
    adsetId: adData[0].adset_id,
    adsetName: adData[0].adset_name,
    ctrDefinition: 'link_ctr = link_clicks / impressions',
    siblingAds: siblings,
    dateRange: { start: startDate, end: endDate }
  };
}
