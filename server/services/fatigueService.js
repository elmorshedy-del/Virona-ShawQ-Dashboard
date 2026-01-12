// server/services/fatigueService.js
// Creative Fatigue Detection Algorithm

/**
 * Fatigue Score Formula:
 * Score = (CTR_decline × 0.4) + (Frequency_factor × 0.3) + (Age_factor × 0.3)
 *
 * Score Interpretation:
 * 0-30: Healthy - Keep running
 * 30-50: Warning - Monitor closely
 * 50-70: Fatigued - Start testing replacements
 * 70-100: Dead - Replace immediately
 */

// ============================================================================
// CALCULATE FATIGUE SCORE FOR SINGLE AD
// ============================================================================
function calculateFatigue(ad) {
  const {
    ad_id,
    ad_name,
    creative_url,
    current_ctr,
    baseline_ctr, // CTR from first 3 days
    frequency,
    start_date,
    impressions,
    spend
  } = ad;

  // Calculate days running
  const startDate = new Date(start_date);
  const now = new Date();
  const daysRunning = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

  // =========================================================================
  // FACTOR 1: CTR Decline (40% weight)
  // =========================================================================
  let ctrDecline = 0;
  if (baseline_ctr && baseline_ctr > 0) {
    ctrDecline = ((baseline_ctr - current_ctr) / baseline_ctr) * 100;
  }
  // Clamp between 0 and 100
  ctrDecline = Math.max(0, Math.min(ctrDecline, 100));
  const ctrFactor = ctrDecline * 0.4;

  // =========================================================================
  // FACTOR 2: Frequency (30% weight)
  // Healthy: 1-3, Warning: 3-5, Fatigued: 5+
  // =========================================================================
  let frequencyFactor = 0;
  if (frequency > 5) {
    frequencyFactor = 100;
  } else if (frequency > 3) {
    frequencyFactor = ((frequency - 3) / 2) * 100;
  } else {
    frequencyFactor = 0;
  }
  frequencyFactor *= 0.3;

  // =========================================================================
  // FACTOR 3: Age (30% weight)
  // 0-7 days: 0, 7-14 days: 50, 14-21 days: 75, 21+ days: 100
  // =========================================================================
  let ageFactor = 0;
  if (daysRunning > 21) {
    ageFactor = 100;
  } else if (daysRunning > 14) {
    ageFactor = 75;
  } else if (daysRunning > 7) {
    ageFactor = 50;
  } else {
    ageFactor = 0;
  }
  ageFactor *= 0.3;

  // =========================================================================
  // TOTAL FATIGUE SCORE
  // =========================================================================
  const fatigueScore = ctrFactor + frequencyFactor + ageFactor;

  // =========================================================================
  // DETERMINE STATUS & RECOMMENDATION
  // =========================================================================
  let status, recommendation, urgency;

  if (fatigueScore >= 70) {
    status = 'dead';
    urgency = 'critical';
    recommendation = 'Replace immediately. This creative is burned out and wasting budget.';
  } else if (fatigueScore >= 50) {
    status = 'fatigued';
    urgency = 'high';
    recommendation = 'Start testing replacements now. Performance is declining rapidly.';
  } else if (fatigueScore >= 30) {
    status = 'warning';
    urgency = 'medium';
    recommendation = 'Monitor closely. Prepare 2-3 new variations to test soon.';
  } else {
    status = 'healthy';
    urgency = 'low';
    recommendation = 'Creative performing well. Continue running and scaling.';
  }

  // Additional insights
  const insights = [];

  if (ctrDecline > 30) {
    insights.push(`CTR dropped ${Math.round(ctrDecline)}% from baseline - audience is tuning out`);
  }

  if (frequency > 4) {
    insights.push(`High frequency (${frequency.toFixed(1)}) - same people seeing ad too often`);
  }

  if (daysRunning > 14) {
    insights.push(`Running ${daysRunning} days - consider fresh creative angles`);
  }

  return {
    ad_id,
    ad_name,
    creative_url,
    fatigue_score: Math.round(fatigueScore),
    status,
    urgency,
    recommendation,
    insights,
    metrics: {
      ctr_baseline: baseline_ctr,
      ctr_current: current_ctr,
      ctr_decline_pct: Math.round(ctrDecline),
      frequency: frequency ? frequency.toFixed(2) : null,
      days_running: daysRunning,
      impressions,
      spend
    },
    factors: {
      ctr_contribution: Math.round(ctrFactor),
      frequency_contribution: Math.round(frequencyFactor),
      age_contribution: Math.round(ageFactor)
    },
    calculated_at: new Date().toISOString()
  };
}

// ============================================================================
// PROCESS MULTIPLE ADS
// ============================================================================
function calculateFatigueForAds(ads) {
  const results = ads.map(ad => calculateFatigue(ad));

  // Sort by fatigue score (worst first)
  results.sort((a, b) => b.fatigue_score - a.fatigue_score);

  // Generate summary
  const summary = {
    total: results.length,
    healthy: results.filter(r => r.status === 'healthy').length,
    warning: results.filter(r => r.status === 'warning').length,
    fatigued: results.filter(r => r.status === 'fatigued').length,
    dead: results.filter(r => r.status === 'dead').length,
    average_score: results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.fatigue_score, 0) / results.length)
      : 0,
    needs_immediate_action: results.filter(r => r.urgency === 'critical' || r.urgency === 'high').length
  };

  // Generate overall recommendation
  let overall_recommendation = '';
  if (summary.dead > 0) {
    overall_recommendation = `🚨 ${summary.dead} ad(s) need immediate replacement. They're wasting budget.`;
  } else if (summary.fatigued > 0) {
    overall_recommendation = `⚠️ ${summary.fatigued} ad(s) showing fatigue. Start testing replacements this week.`;
  } else if (summary.warning > 0) {
    overall_recommendation = `👀 ${summary.warning} ad(s) to monitor. Prepare backup creatives.`;
  } else {
    overall_recommendation = `✅ All creatives healthy! Keep scaling winners.`;
  }

  return {
    summary,
    overall_recommendation,
    ads: results
  };
}

// ============================================================================
// GET REPLACEMENT SUGGESTIONS
// ============================================================================
function getReplacementSuggestions(fatiguedAd, winningPatterns = []) {
  const suggestions = [];

  // Based on what's fatiguing
  if (fatiguedAd.metrics.ctr_decline_pct > 30) {
    suggestions.push({
      type: 'hook',
      suggestion: 'Try a completely different hook angle - the current one has lost impact',
      priority: 'high'
    });
  }

  if (fatiguedAd.metrics.frequency > 4) {
    suggestions.push({
      type: 'audience',
      suggestion: 'Expand audience or create lookalikes to reach fresh eyes',
      priority: 'high'
    });
  }

  if (fatiguedAd.metrics.days_running > 21) {
    suggestions.push({
      type: 'creative',
      suggestion: 'Test new visual style - same product, different aesthetic',
      priority: 'medium'
    });
  }

  // General suggestions
  suggestions.push({
    type: 'format',
    suggestion: 'Try different format (if image, test video; if feed, test story)',
    priority: 'medium'
  });

  suggestions.push({
    type: 'ugc',
    suggestion: 'User-generated content often resets fatigue',
    priority: 'medium'
  });

  return suggestions;
}

export {
  calculateFatigue,
  calculateFatigueForAds,
  getReplacementSuggestions
};
