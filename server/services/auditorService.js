// server/services/auditorService.js
// Ad Account Health Auditor Algorithm

/**
 * Health Score starts at 100 and deducts points for issues found.
 * 
 * Checks performed:
 * 1. Audience Overlap (up to -20 points)
 * 2. Frequency Issues (up to -15 points)
 * 3. Learning Phase Stuck (up to -15 points)
 * 4. Budget Waste (up to -15 points)
 * 5. Creative Diversity (up to -10 points)
 * 6. Attribution Gaps (up to -10 points)
 * 7. Fatigued Creatives (up to -15 points)
 */

import * as fatigueService from './fatigueService.js';

// ============================================================================
// MAIN AUDIT FUNCTION
// ============================================================================
async function runFullAudit(accountData) {
  const issues = [];
  const recommendations = [];
  let healthScore = 100;

  const {
    adSets = [],
    ads = [],
    dailyMetrics = [],
    shopifyOrders = [],
    metaConversions = []
  } = accountData;

  // =========================================================================
  // CHECK 1: Audience Overlap (up to -20 points)
  // =========================================================================
  const overlapResult = checkAudienceOverlap(adSets);
  if (overlapResult.hasIssue) {
    const deduction = Math.min(overlapResult.severity * 5, 20);
    healthScore -= deduction;
    issues.push({
      type: 'audience_overlap',
      severity: overlapResult.severity > 3 ? 'high' : 'medium',
      title: 'Audience Overlap Detected',
      message: overlapResult.message,
      affected: overlapResult.affected,
      deduction
    });
    recommendations.push({
      priority: 'high',
      action: 'Consolidate overlapping audiences or add exclusions',
      impact: 'Reduce internal competition and lower CPMs',
      effort: 'medium'
    });
  }

  // =========================================================================
  // CHECK 2: Frequency Issues (up to -15 points)
  // =========================================================================
  const frequencyResult = checkFrequencyIssues(ads, dailyMetrics);
  if (frequencyResult.hasIssue) {
    const deduction = Math.min(frequencyResult.count * 3, 15);
    healthScore -= deduction;
    issues.push({
      type: 'high_frequency',
      severity: frequencyResult.avgFrequency > 5 ? 'high' : 'medium',
      title: 'High Frequency Ads',
      message: `${frequencyResult.count} ads have frequency > 3`,
      affected: frequencyResult.affected,
      deduction
    });
    recommendations.push({
      priority: 'high',
      action: 'Expand audiences or rotate creatives for high-frequency ads',
      impact: 'Reduce ad fatigue and improve engagement',
      effort: 'low'
    });
  }

  // =========================================================================
  // CHECK 3: Learning Phase Stuck (up to -15 points)
  // =========================================================================
  const learningResult = checkLearningPhase(adSets, dailyMetrics);
  if (learningResult.hasIssue) {
    const deduction = Math.min(learningResult.count * 5, 15);
    healthScore -= deduction;
    issues.push({
      type: 'learning_phase_stuck',
      severity: 'high',
      title: 'Ad Sets Stuck in Learning',
      message: `${learningResult.count} ad sets have < 50 conversions in 7 days`,
      affected: learningResult.affected,
      deduction
    });
    recommendations.push({
      priority: 'high',
      action: 'Increase budgets or broaden targeting for stuck ad sets',
      impact: 'Enable proper optimization and lower CPA',
      effort: 'medium'
    });
  }

  // =========================================================================
  // CHECK 4: Budget Waste (up to -15 points)
  // =========================================================================
  const wasteResult = checkBudgetWaste(adSets, dailyMetrics);
  if (wasteResult.hasIssue) {
    const deduction = Math.min(wasteResult.wastedAmount / 50, 15);
    healthScore -= deduction;
    issues.push({
      type: 'budget_waste',
      severity: wasteResult.wastedAmount > 500 ? 'high' : 'medium',
      title: 'Budget Waste Detected',
      message: `$${wasteResult.wastedAmount.toFixed(0)} spent on 0-conversion ad sets (7 days)`,
      affected: wasteResult.affected,
      deduction
    });
    recommendations.push({
      priority: 'medium',
      action: 'Pause or reallocate budget from non-converting ad sets',
      impact: 'Improve overall ROAS by focusing on winners',
      effort: 'low'
    });
  }

  // =========================================================================
  // CHECK 5: Creative Diversity (up to -10 points)
  // =========================================================================
  const diversityResult = checkCreativeDiversity(ads);
  if (diversityResult.hasIssue) {
    healthScore -= 10;
    issues.push({
      type: 'low_creative_diversity',
      severity: 'low',
      title: 'Low Creative Diversity',
      message: `Only ${diversityResult.uniqueCreatives} unique creatives across ${diversityResult.totalAds} ads`,
      affected: [],
      deduction: 10
    });
    recommendations.push({
      priority: 'low',
      action: 'Test more creative variations to find new winners',
      impact: 'Discover new angles and reduce fatigue risk',
      effort: 'medium'
    });
  }

  // =========================================================================
  // CHECK 6: Attribution Gaps (up to -10 points)
  // =========================================================================
  const attributionResult = checkAttributionGaps(metaConversions, shopifyOrders);
  if (attributionResult.hasIssue) {
    healthScore -= 10;
    issues.push({
      type: 'attribution_gap',
      severity: 'medium',
      title: 'Attribution Discrepancy',
      message: `${attributionResult.gapPercent}% difference between Meta and actual conversions`,
      affected: [],
      deduction: 10
    });
    recommendations.push({
      priority: 'medium',
      action: 'Review pixel setup and consider server-side tracking (CAPI)',
      impact: 'Improve data accuracy for better optimization',
      effort: 'high'
    });
  }

  // =========================================================================
  // CHECK 7: Fatigued Creatives (up to -15 points)
  // =========================================================================
  const fatigueResult = checkFatiguedCreatives(ads, dailyMetrics);
  if (fatigueResult.hasIssue) {
    const deduction = Math.min(fatigueResult.count * 3, 15);
    healthScore -= deduction;
    issues.push({
      type: 'fatigued_creatives',
      severity: fatigueResult.count > 5 ? 'high' : 'medium',
      title: 'Fatigued Creatives',
      message: `${fatigueResult.count} creatives showing CTR decline > 30%`,
      affected: fatigueResult.affected,
      deduction
    });
    recommendations.push({
      priority: 'high',
      action: 'Replace fatigued creatives with fresh variations',
      impact: 'Restore CTR and reduce CPM',
      effort: 'medium'
    });
  }

  // =========================================================================
  // CALCULATE FINAL SCORE & STATUS
  // =========================================================================
  healthScore = Math.max(0, Math.round(healthScore));

  let status, statusEmoji;
  if (healthScore >= 80) {
    status = 'healthy';
    statusEmoji = '✅';
  } else if (healthScore >= 60) {
    status = 'needs_attention';
    statusEmoji = '👀';
  } else if (healthScore >= 40) {
    status = 'warning';
    statusEmoji = '⚠️';
  } else {
    status = 'critical';
    statusEmoji = '🚨';
  }

  // Sort issues by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Sort recommendations by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Generate summary message
  let summaryMessage;
  if (status === 'healthy') {
    summaryMessage = 'Your ad account is in great shape! Keep monitoring and scaling winners.';
  } else if (status === 'needs_attention') {
    summaryMessage = 'A few issues to address. Focus on the high-priority recommendations.';
  } else if (status === 'warning') {
    summaryMessage = 'Several issues affecting performance. Take action this week.';
  } else {
    summaryMessage = 'Critical issues detected! Immediate action required to stop budget waste.';
  }

  return {
    health_score: healthScore,
    status,
    status_emoji: statusEmoji,
    summary_message: summaryMessage,
    issues,
    recommendations,
    summary: {
      total_issues: issues.length,
      high_severity: issues.filter(i => i.severity === 'high').length,
      medium_severity: issues.filter(i => i.severity === 'medium').length,
      low_severity: issues.filter(i => i.severity === 'low').length,
      total_deductions: 100 - healthScore
    },
    audit_date: new Date().toISOString()
  };
}

// ============================================================================
// INDIVIDUAL CHECK FUNCTIONS
// ============================================================================

function checkAudienceOverlap(adSets) {
  // Simplified - in real implementation, query Meta API for audience overlap
  // This is a placeholder that checks for obvious naming patterns
  const overlappingPairs = [];

  for (let i = 0; i < adSets.length; i++) {
    for (let j = i + 1; j < adSets.length; j++) {
      // Simple heuristic: same targeting description = likely overlap
      if (adSets[i].targeting_description === adSets[j].targeting_description) {
        overlappingPairs.push({
          adset1: adSets[i].name,
          adset2: adSets[j].name
        });
      }
    }
  }

  return {
    hasIssue: overlappingPairs.length > 0,
    severity: overlappingPairs.length,
    message: `${overlappingPairs.length} potential audience overlaps detected`,
    affected: overlappingPairs
  };
}

function checkFrequencyIssues(ads, dailyMetrics) {
  const highFrequencyAds = [];

  for (const ad of ads) {
    const adMetrics = dailyMetrics.filter(m => m.ad_id === ad.id);
    if (adMetrics.length > 0) {
      const avgFrequency = adMetrics.reduce((sum, m) => sum + (m.frequency || 0), 0) / adMetrics.length;
      if (avgFrequency > 3) {
        highFrequencyAds.push({
          ad_id: ad.id,
          ad_name: ad.name,
          frequency: avgFrequency.toFixed(2)
        });
      }
    }
  }

  return {
    hasIssue: highFrequencyAds.length > 0,
    count: highFrequencyAds.length,
    avgFrequency: highFrequencyAds.length > 0
      ? highFrequencyAds.reduce((sum, a) => sum + parseFloat(a.frequency), 0) / highFrequencyAds.length
      : 0,
    affected: highFrequencyAds
  };
}

function checkLearningPhase(adSets, dailyMetrics) {
  const stuckAdSets = [];
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const adSet of adSets) {
    const recentMetrics = dailyMetrics.filter(m =>
      m.adset_id === adSet.id &&
      new Date(m.date) >= sevenDaysAgo
    );

    const totalConversions = recentMetrics.reduce((sum, m) => sum + (m.conversions || 0), 0);

    if (totalConversions < 50 && adSet.status === 'ACTIVE') {
      stuckAdSets.push({
        adset_id: adSet.id,
        adset_name: adSet.name,
        conversions_7d: totalConversions
      });
    }
  }

  return {
    hasIssue: stuckAdSets.length > 0,
    count: stuckAdSets.length,
    affected: stuckAdSets
  };
}

function checkBudgetWaste(adSets, dailyMetrics) {
  const wastefulAdSets = [];
  let totalWasted = 0;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const adSet of adSets) {
    const recentMetrics = dailyMetrics.filter(m =>
      m.adset_id === adSet.id &&
      new Date(m.date) >= sevenDaysAgo
    );

    const totalSpend = recentMetrics.reduce((sum, m) => sum + (m.spend || 0), 0);
    const totalConversions = recentMetrics.reduce((sum, m) => sum + (m.conversions || 0), 0);

    if (totalSpend > 50 && totalConversions === 0) {
      wastefulAdSets.push({
        adset_id: adSet.id,
        adset_name: adSet.name,
        spend_7d: totalSpend,
        conversions_7d: 0
      });
      totalWasted += totalSpend;
    }
  }

  return {
    hasIssue: wastefulAdSets.length > 0,
    wastedAmount: totalWasted,
    affected: wastefulAdSets
  };
}

function checkCreativeDiversity(ads) {
  const uniqueCreatives = new Set();

  for (const ad of ads) {
    if (ad.creative_url || ad.creative_id) {
      uniqueCreatives.add(ad.creative_url || ad.creative_id);
    }
  }

  const ratio = ads.length > 0 ? uniqueCreatives.size / ads.length : 1;

  return {
    hasIssue: ratio < 0.5 && ads.length > 5,
    uniqueCreatives: uniqueCreatives.size,
    totalAds: ads.length,
    ratio
  };
}

function checkAttributionGaps(metaConversions, shopifyOrders) {
  if (!metaConversions.length || !shopifyOrders.length) {
    return { hasIssue: false, gapPercent: 0 };
  }

  const metaTotal = metaConversions.reduce((sum, c) => sum + (c.value || 0), 0);
  const shopifyTotal = shopifyOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  if (shopifyTotal === 0) {
    return { hasIssue: false, gapPercent: 0 };
  }

  const gapPercent = Math.abs(((metaTotal - shopifyTotal) / shopifyTotal) * 100);

  return {
    hasIssue: gapPercent > 20,
    gapPercent: Math.round(gapPercent),
    metaTotal,
    shopifyTotal
  };
}

function checkFatiguedCreatives(ads, dailyMetrics) {
  const fatigued = [];

  for (const ad of ads) {
    const adMetrics = dailyMetrics
      .filter(m => m.ad_id === ad.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (adMetrics.length >= 7) {
      // Get baseline CTR (first 3 days)
      const baselineMetrics = adMetrics.slice(0, 3);
      const baselineCtr = baselineMetrics.reduce((sum, m) => sum + (m.ctr || 0), 0) / 3;

      // Get current CTR (last 3 days)
      const currentMetrics = adMetrics.slice(-3);
      const currentCtr = currentMetrics.reduce((sum, m) => sum + (m.ctr || 0), 0) / 3;

      if (baselineCtr > 0) {
        const decline = ((baselineCtr - currentCtr) / baselineCtr) * 100;
        if (decline > 30) {
          fatigued.push({
            ad_id: ad.id,
            ad_name: ad.name,
            baseline_ctr: baselineCtr.toFixed(2),
            current_ctr: currentCtr.toFixed(2),
            decline_percent: Math.round(decline)
          });
        }
      }
    }
  }

  return {
    hasIssue: fatigued.length > 0,
    count: fatigued.length,
    affected: fatigued
  };
}

// ============================================================================
// GENERATE AUDIT REPORT (for email/PDF)
// ============================================================================
function generateAuditReport(audit) {
  const lines = [];

  lines.push(`# Ad Account Health Report`);
  lines.push(`Generated: ${new Date(audit.audit_date).toLocaleDateString()}`);
  lines.push('');
  lines.push(`## Overall Health Score: ${audit.health_score}/100 ${audit.status_emoji}`);
  lines.push(audit.summary_message);
  lines.push('');

  if (audit.issues.length > 0) {
    lines.push(`## Issues Found (${audit.issues.length})`);
    lines.push('');
    for (const issue of audit.issues) {
      const severityIcon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      lines.push(`### ${severityIcon} ${issue.title}`);
      lines.push(issue.message);
      lines.push('');
    }
  }

  if (audit.recommendations.length > 0) {
    lines.push(`## Recommended Actions`);
    lines.push('');
    for (let i = 0; i < audit.recommendations.length; i++) {
      const rec = audit.recommendations[i];
      lines.push(`${i + 1}. **${rec.action}**`);
      lines.push(`   Impact: ${rec.impact}`);
      lines.push(`   Effort: ${rec.effort}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export {
  runFullAudit,
  generateAuditReport
};
