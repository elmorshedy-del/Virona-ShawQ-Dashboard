const FRESH_THRESHOLD_PURCHASES = 30;
const FRESH_THRESHOLD_DAYS = 7;
const ESTABLISHED_CONFIDENCE_PURCHASES = 100;
const EARLY_KILL_CTR = 0.005;
const EARLY_KILL_IMPRESSIONS = 1000;
const PROMISING_MULTIPLIER = 1.2;

export default class CampaignIntelligenceService {
  constructor(db) {
    this.db = {
      get: (sql, params = []) => db.prepare(sql).get(params),
      all: (sql, params = []) => db.prepare(sql).all(params),
      run: (sql, params = []) => db.prepare(sql).run(params),
    };
  }

  // --------------------------------------------
  // GET BLENDED BENCHMARK
  // --------------------------------------------
  async getBenchmark(geo, store) {
    const learned = await this.db.get(
      `
      SELECT * FROM geo_benchmarks 
      WHERE geo = ? AND store = ?
    `,
      [geo, store]
    );

    let industry = await this.db.get(
      `
      SELECT * FROM industry_benchmarks WHERE geo = ?
    `,
      [geo]
    );

    if (!industry) {
      industry = await this.db.get(
        `
        SELECT * FROM industry_benchmarks WHERE geo = 'GLOBAL'
      `
      );
    }

    if (!learned || learned.campaigns_count === 0) {
      return { source: 'industry', weight: 0, ...industry };
    }

    const weight = Math.min(1, learned.campaigns_count / 10);

    return {
      source: weight >= 1 ? 'learned' : 'blended',
      weight,
      campaigns_count: learned.campaigns_count,
      ctr_avg: this.blend(learned.ctr_avg, industry.ctr_avg, weight),
      atc_rate_avg: this.blend(learned.atc_rate_avg, industry.atc_rate_avg, weight),
      ic_rate_avg: this.blend(learned.ic_rate_avg, industry.ic_rate_avg, weight),
      cvr_avg: this.blend(learned.cvr_avg, industry.cvr_avg, weight),
      cpm_avg: this.blend(learned.cpm_avg, industry.cpm_avg, weight),
      cac_avg: learned.cac_avg,
      roas_avg: learned.roas_avg,
      ctr_min: learned.ctr_min,
      ctr_max: learned.ctr_max,
    };
  }

  blend(learned, industry, weight) {
    if (learned == null) return industry;
    if (industry == null) return learned;
    return weight * learned + (1 - weight) * industry;
  }

  // --------------------------------------------
  // ANALYZE SINGLE CAMPAIGN
  // --------------------------------------------
  async analyzeCampaign(campaignId, store) {
    const metrics = await this.db.get(
      `
      SELECT 
        m.campaign_id,
        o.campaign_name,
        COUNT(DISTINCT m.date) as days_running,
        SUM(m.spend) as total_spend,
        SUM(m.impressions) as total_impressions,
        SUM(m.clicks) as total_clicks,
        SUM(COALESCE(m.conversions, m.purchases, 0)) as total_purchases,
        SUM(COALESCE(m.conversion_value, m.purchase_value, 0)) as total_revenue,
        SUM(m.add_to_cart) as total_atc,
        SUM(m.checkouts_initiated) as total_ic,
        MAX(m.country) as primary_geo
      FROM meta_daily_metrics m
      LEFT JOIN meta_objects o ON m.campaign_id = o.object_id AND o.object_type = 'campaign'
      WHERE m.campaign_id = ? AND m.store = ?
      GROUP BY m.campaign_id
    `,
      [campaignId, store]
    );

    if (!metrics) {
      return { error: 'Campaign not found' };
    }

    const status =
      metrics.total_purchases < FRESH_THRESHOLD_PURCHASES || metrics.days_running < FRESH_THRESHOLD_DAYS
        ? 'fresh'
        : 'established';

    const ctr = metrics.total_impressions > 0 ? metrics.total_clicks / metrics.total_impressions : 0;
    const atc_rate = metrics.total_clicks > 0 ? metrics.total_atc / metrics.total_clicks : 0;
    const ic_rate = metrics.total_atc > 0 ? metrics.total_ic / metrics.total_atc : 0;
    const cvr = metrics.total_clicks > 0 ? metrics.total_purchases / metrics.total_clicks : 0;
    const cac = metrics.total_purchases > 0 ? metrics.total_spend / metrics.total_purchases : null;
    const roas = metrics.total_spend > 0 ? metrics.total_revenue / metrics.total_spend : 0;

    const geo = metrics.primary_geo || 'SA';
    const benchmark = await this.getBenchmark(geo, store);

    const comparison = {
      ctr: this.compareMetric(ctr, benchmark.ctr_avg, 'higher'),
      atc_rate: this.compareMetric(atc_rate, benchmark.atc_rate_avg, 'higher'),
      ic_rate: this.compareMetric(ic_rate, benchmark.ic_rate_avg, 'higher'),
      cvr:
        metrics.total_purchases >= 10
          ? this.compareMetric(cvr, benchmark.cvr_avg, 'higher')
          : { status: 'insufficient', label: 'Too few purchases' },
      cac:
        cac && benchmark.cac_avg
          ? this.compareMetric(cac, benchmark.cac_avg, 'lower')
          : { status: 'insufficient', label: 'No CAC data' },
    };

    const diagnosis = this.diagnoseFunnel(comparison);
    const recommendation = this.getRecommendation(status, diagnosis, metrics, comparison);
    const confidence = this.getConfidence(metrics.total_purchases, metrics.days_running);

    const testBudget = status === 'fresh' ? this.getTestBudgetGuide(metrics, benchmark) : null;

    const budgetOptimization = status === 'established'
      ? await this.getBudgetOptimization(campaignId, store, metrics)
      : null;

    return {
      campaign_id: campaignId,
      campaign_name: metrics.campaign_name,
      store,
      geo,
      status,

      metrics: {
        days_running: metrics.days_running,
        total_spend: Math.round(metrics.total_spend * 100) / 100,
        total_purchases: metrics.total_purchases,
        total_revenue: Math.round(metrics.total_revenue * 100) / 100,
        impressions: metrics.total_impressions,
        clicks: metrics.total_clicks,
      },

      funnel: {
        ctr: { value: ctr, formatted: (ctr * 100).toFixed(2) + '%' },
        atc_rate: { value: atc_rate, formatted: (atc_rate * 100).toFixed(2) + '%' },
        ic_rate: { value: ic_rate, formatted: (ic_rate * 100).toFixed(2) + '%' },
        cvr: { value: cvr, formatted: (cvr * 100).toFixed(2) + '%' },
        cac: { value: cac, formatted: cac ? Math.round(cac) + ' SAR' : '—' },
        roas: { value: roas, formatted: roas.toFixed(2) + 'x' },
      },

      benchmark: {
        source: benchmark.source,
        weight: Math.round(benchmark.weight * 100),
        campaigns_learned: benchmark.campaigns_count || 0,
        geo,
        values: {
          ctr: benchmark.ctr_avg,
          atc_rate: benchmark.atc_rate_avg,
          ic_rate: benchmark.ic_rate_avg,
          cvr: benchmark.cvr_avg,
          cac: benchmark.cac_avg,
        },
      },

      comparison,
      diagnosis,
      recommendation,
      confidence,
      testBudget,
      budgetOptimization,
    };
  }

  // --------------------------------------------
  // COMPARE METRIC TO BENCHMARK
  // --------------------------------------------
  compareMetric(value, benchmark, direction) {
    if (value == null || benchmark == null) {
      return { status: 'insufficient', label: 'No data' };
    }

    const ratio = value / benchmark;
    const percentDiff = ((value - benchmark) / benchmark) * 100;

    let status;
    if (direction === 'higher') {
      if (ratio >= PROMISING_MULTIPLIER) status = 'good';
      else if (ratio >= 0.9) status = 'ok';
      else if (ratio >= 0.7) status = 'below';
      else status = 'poor';
    } else {
      if (ratio <= 0.8) status = 'good';
      else if (ratio <= 1.1) status = 'ok';
      else if (ratio <= 1.3) status = 'below';
      else status = 'poor';
    }

    return {
      status,
      ratio: Math.round(ratio * 100) / 100,
      percentDiff: Math.round(percentDiff),
      label: this.getComparisonLabel(status, percentDiff, direction),
    };
  }

  getComparisonLabel(status, percentDiff, direction) {
    const absPercent = Math.abs(Math.round(percentDiff));
    switch (status) {
      case 'good':
        return `✅ ${absPercent}% ${direction === 'higher' ? 'above' : 'below'} avg`;
      case 'ok':
        return '➖ Near average';
      case 'below':
        return `⚠️ ${absPercent}% ${direction === 'higher' ? 'below' : 'above'} avg`;
      case 'poor':
        return `❌ ${absPercent}% ${direction === 'higher' ? 'below' : 'above'} avg`;
      default:
        return '—';
    }
  }

  // --------------------------------------------
  // DIAGNOSE FUNNEL
  // --------------------------------------------
  diagnoseFunnel(comparison) {
    const dominated = [];

    if (comparison.ctr.status === 'poor' || comparison.ctr.status === 'below') {
      dominated.push('top');
    }
    if (comparison.atc_rate.status === 'poor' || comparison.atc_rate.status === 'below') {
      dominated.push('middle');
    }
    if (comparison.ic_rate.status === 'poor' || comparison.ic_rate.status === 'below') {
      dominated.push('middle');
    }
    if (comparison.cvr.status === 'poor') {
      dominated.push('bottom');
    }

    if (dominated.length === 0) {
      return {
        health: 'healthy',
        label: '✅ Funnel looks healthy',
        detail: 'All metrics at or above benchmarks.',
      };
    }

    const unique = [...new Set(dominated)];

    if (unique.includes('top') && unique.length === 1) {
      return {
        health: 'weak_top',
        label: '⚠️ Weak top of funnel',
        detail: 'Low CTR — creative or targeting issue. People not clicking.',
      };
    }

    if (unique.includes('middle') && !unique.includes('top')) {
      return {
        health: 'weak_middle',
        label: '⚠️ Weak middle of funnel',
        detail: "People click but don't add to cart. Landing page or offer issue.",
      };
    }

    if (unique.includes('bottom') && unique.length === 1) {
      return {
        health: 'weak_bottom',
        label: '⚠️ Weak bottom of funnel',
        detail: "People checkout but don't buy. Payment, shipping, or trust issue.",
      };
    }

    return {
      health: 'weak_multiple',
      label: '❌ Multiple funnel issues',
      detail: `Problems in: ${unique.join(', ')} funnel`,
    };
  }

  // --------------------------------------------
  // GET RECOMMENDATION
  // --------------------------------------------
  getRecommendation(status, diagnosis, metrics, comparison) {
    if (metrics.total_impressions >= EARLY_KILL_IMPRESSIONS) {
      const ctr = metrics.total_clicks / metrics.total_impressions;
      if (ctr < EARLY_KILL_CTR) {
        return {
          action: 'kill',
          label: '❌ Kill this campaign',
          reason: `CTR is ${(ctr * 100).toFixed(2)}% after ${metrics.total_impressions.toLocaleString()} impressions. Creative not working.`,
        };
      }
    }

    if (metrics.total_clicks >= 500 && metrics.total_atc === 0) {
      return {
        action: 'kill',
        label: '❌ Kill — Landing page broken?',
        reason: `${metrics.total_clicks} clicks but 0 add-to-carts. Check landing page.`,
      };
    }

    if (status === 'fresh' && diagnosis.health === 'healthy') {
      return {
        action: 'push',
        label: '🚀 Push — Increase budget',
        reason: 'Funnel looks healthy. Low purchase count is likely volume issue. Spend more to gather data faster.',
      };
    }

    if (status === 'fresh' && diagnosis.health !== 'healthy') {
      return {
        action: 'fix',
        label: '🔧 Fix before scaling',
        reason: `${diagnosis.detail} Fix this before increasing spend.`,
      };
    }

    if (status === 'established') {
      if (diagnosis.health === 'healthy') {
        return {
          action: 'optimize',
          label: '📈 Ready to optimize',
          reason: 'Enough data for budget optimization. Check saturation curve.',
        };
      } else {
        return {
          action: 'fix',
          label: '🔧 Fix funnel issues',
          reason: diagnosis.detail,
        };
      }
    }

    return {
      action: 'watch',
      label: '👀 Keep watching',
      reason: 'Need more data to make recommendation.',
    };
  }

  // --------------------------------------------
  // GET CONFIDENCE LEVEL
  // --------------------------------------------
  getConfidence(purchases, days) {
    if (purchases >= ESTABLISHED_CONFIDENCE_PURCHASES && days >= 14) {
      return { level: 'high', label: 'High confidence', percent: 90 };
    }
    if (purchases >= FRESH_THRESHOLD_PURCHASES && days >= 7) {
      return { level: 'medium', label: 'Medium confidence', percent: 70 };
    }
    if (purchases >= 10) {
      return { level: 'low', label: 'Low confidence', percent: 50 };
    }
    return { level: 'very_low', label: 'Very low — need more data', percent: 30 };
  }

  // --------------------------------------------
  // TEST BUDGET GUIDE (Fresh Mode)
  // --------------------------------------------
  getTestBudgetGuide(metrics, benchmark) {
    const dailySpend = metrics.days_running > 0 ? metrics.total_spend / metrics.days_running : 0;

    const estimatedCPM = benchmark.cpm_avg || 20;
    const estimatedCVR = benchmark.cvr_avg || 0.025;

    const targetPurchases = 30;
    const purchasesNeeded = targetPurchases - metrics.total_purchases;

    if (purchasesNeeded <= 0) {
      return {
        phase: 'complete',
        label: 'Ready for optimization',
        detail: 'You have enough data. Switch to Established Mode.',
      };
    }

    const estimatedCPC = estimatedCPM / 1000 / (benchmark.ctr_avg || 0.012);
    const spendNeeded = (purchasesNeeded / estimatedCVR) * estimatedCPC;

    const phase1Daily = 300;
    const phase2Daily = 500;

    return {
      phase: metrics.total_purchases < 15 ? 'discovery' : 'validation',
      current_daily: Math.round(dailySpend),
      phases: [
        {
          name: 'Discovery',
          daily_budget: phase1Daily,
          duration_days: 14,
          total: phase1Daily * 14,
          goal: '25-30 purchases, validate funnel works',
          status: metrics.total_purchases >= 15 ? 'complete' : 'active',
        },
        {
          name: 'Validation',
          daily_budget: phase2Daily,
          duration_days: 14,
          total: phase2Daily * 14,
          goal: '50+ purchases, confirm CAC is sustainable',
          status: metrics.total_purchases >= 30 ? 'complete' : metrics.total_purchases >= 15 ? 'active' : 'pending',
        },
        {
          name: 'Scale',
          daily_budget: null,
          duration_days: null,
          total: null,
          goal: 'Use optimizer with real data',
          status: 'pending',
        },
      ],
      purchases_needed: purchasesNeeded,
      estimated_spend_needed: Math.round(spendNeeded),
    };
  }

  // --------------------------------------------
  // BUDGET OPTIMIZATION (Established Mode)
  // --------------------------------------------
  async getBudgetOptimization(campaignId, store, metrics) {
    const dailyData = await this.db.all(
      `
      SELECT 
        date,
        SUM(spend) as spend,
        SUM(COALESCE(conversions, purchases, 0)) as purchases,
        SUM(COALESCE(conversion_value, purchase_value, 0)) as revenue
      FROM meta_daily_metrics
      WHERE campaign_id = ? AND store = ?
      GROUP BY date
      ORDER BY date
    `,
      [campaignId, store]
    );

    if (dailyData.length < 7) {
      return { error: 'Need at least 7 days of data' };
    }

    const spends = dailyData.map((d) => d.spend);
    const revenues = dailyData.map((d) => d.revenue);

    const avgSpend = spends.reduce((a, b) => a + b, 0) / spends.length;
    const estimatedKnee = avgSpend * 1.4;
    const estimatedSaturation = avgSpend * 2.0;

    const headroom = ((estimatedKnee - avgSpend) / avgSpend) * 100;

    return {
      current_daily: Math.round(avgSpend),
      optimal_daily: Math.round(estimatedKnee),
      saturation_daily: Math.round(estimatedSaturation),
      headroom_percent: Math.round(headroom),
      avg_roas: metrics.total_spend > 0 ? Math.round((metrics.total_revenue / metrics.total_spend) * 100) / 100 : 0,
      data_points: dailyData.length,
      confidence: dailyData.length >= 14 ? 'medium' : 'low',
    };
  }

  // --------------------------------------------
  // BAYESIAN A/B COMPARISON
  // --------------------------------------------
  compareAdSets(adSetA, adSetB) {
    const { clicks: clicksA, purchases: purchasesA } = adSetA;
    const { clicks: clicksB, purchases: purchasesB } = adSetB;

    const simulations = 10000;
    let aWins = 0;

    for (let i = 0; i < simulations; i += 1) {
      const rateA = this.betaSample(purchasesA + 1, clicksA - purchasesA + 1);
      const rateB = this.betaSample(purchasesB + 1, clicksB - purchasesB + 1);
      if (rateA > rateB) aWins += 1;
    }

    const probABetter = aWins / simulations;

    let verdict;
    let recommendation;
    if (probABetter >= 0.95) {
      verdict = 'A is very likely better';
      recommendation = 'Shift budget from B to A';
    } else if (probABetter >= 0.8) {
      verdict = 'A is probably better';
      recommendation = 'Consider shifting budget to A';
    } else if (probABetter >= 0.6) {
      verdict = 'A might be better, uncertain';
      recommendation = 'Keep running both, check again later';
    } else if (probABetter >= 0.4) {
      verdict = 'Too close to call';
      recommendation = 'Need more data';
    } else if (probABetter >= 0.2) {
      verdict = 'B might be better';
      recommendation = 'Consider shifting budget to B';
    } else {
      verdict = 'B is probably better';
      recommendation = 'Shift budget from A to B';
    }

    return {
      probability_a_better: Math.round(probABetter * 100),
      probability_b_better: Math.round((1 - probABetter) * 100),
      verdict,
      recommendation,
      stats: {
        a: { clicks: clicksA, purchases: purchasesA, cvr: `${((purchasesA / clicksA) * 100).toFixed(2)}%` },
        b: { clicks: clicksB, purchases: purchasesB, cvr: `${((purchasesB / clicksB) * 100).toFixed(2)}%` },
      },
    };
  }

  betaSample(alpha, beta) {
    const x = this.gammaSample(alpha);
    const y = this.gammaSample(beta);
    return x / (x + y);
  }

  gammaSample(shape) {
    if (shape < 1) {
      return this.gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x;
      let v;
      do {
        x = this.normalSample();
        v = 1 + c * x;
      } while (v <= 0);

      v *= v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  normalSample() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // --------------------------------------------
  // GET ALL CAMPAIGNS OVERVIEW
  // --------------------------------------------
  async getAllCampaigns(store) {
    const campaigns = await this.db.all(
      `
      SELECT 
        m.campaign_id,
        o.campaign_name,
        MAX(m.country) as primary_geo,
        COUNT(DISTINCT m.date) as days_running,
        SUM(m.spend) as total_spend,
        SUM(COALESCE(m.conversions, m.purchases, 0)) as total_purchases,
        SUM(COALESCE(m.conversion_value, m.purchase_value, 0)) as total_revenue
      FROM meta_daily_metrics m
      LEFT JOIN meta_objects o ON m.campaign_id = o.object_id AND o.object_type = 'campaign'
      WHERE m.store = ?
      GROUP BY m.campaign_id
      ORDER BY total_spend DESC
    `,
      [store]
    );

    return campaigns.map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name || c.campaign_id,
      geo: c.primary_geo || 'SA',
      days_running: c.days_running,
      total_spend: Math.round(c.total_spend * 100) / 100,
      total_purchases: c.total_purchases,
      total_revenue: Math.round(c.total_revenue * 100) / 100,
      roas: c.total_spend > 0 ? Math.round((c.total_revenue / c.total_spend) * 100) / 100 : 0,
      status:
        c.total_purchases < FRESH_THRESHOLD_PURCHASES || c.days_running < FRESH_THRESHOLD_DAYS
          ? 'fresh'
          : 'established',
    }));
  }

  // --------------------------------------------
  // GET GEO COMPARISON
  // --------------------------------------------
  async getGeoComparison(store) {
    const geos = await this.db.all(
      `
      SELECT 
        country as geo,
        SUM(spend) as total_spend,
        SUM(COALESCE(conversions, purchases, 0)) as total_purchases,
        SUM(COALESCE(conversion_value, purchase_value, 0)) as total_revenue,
        COUNT(DISTINCT campaign_id) as campaigns_count
      FROM meta_daily_metrics
      WHERE store = ? AND country IS NOT NULL
      GROUP BY country
      ORDER BY total_spend DESC
    `,
      [store]
    );

    return geos.map((g) => ({
      geo: g.geo,
      total_spend: Math.round(g.total_spend),
      total_purchases: g.total_purchases,
      total_revenue: Math.round(g.total_revenue),
      cac: g.total_purchases > 0 ? Math.round(g.total_spend / g.total_purchases) : null,
      roas: g.total_spend > 0 ? Math.round((g.total_revenue / g.total_spend) * 100) / 100 : 0,
      campaigns_count: g.campaigns_count,
      status: g.total_purchases >= 30 ? 'established' : 'fresh',
    }));
  }

  // --------------------------------------------
  // UPDATE BENCHMARKS FROM COMPLETED CAMPAIGNS
  // --------------------------------------------
  async updateBenchmarksFromCampaign(campaignId, store) {
    const metrics = await this.db.get(
      `
      SELECT 
        MAX(country) as geo,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as ic,
        SUM(COALESCE(conversions, purchases, 0)) as purchases,
        SUM(spend) as spend,
        SUM(COALESCE(conversion_value, purchase_value, 0)) as revenue
      FROM meta_daily_metrics
      WHERE campaign_id = ? AND store = ?
    `,
      [campaignId, store]
    );

    if (!metrics || metrics.purchases < FRESH_THRESHOLD_PURCHASES) {
      return { updated: false, reason: 'Not enough purchases' };
    }

    const geo = metrics.geo || 'SA';
    const ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : null;
    const atc_rate = metrics.clicks > 0 ? metrics.atc / metrics.clicks : null;
    const ic_rate = metrics.atc > 0 ? metrics.ic / metrics.atc : null;
    const cvr = metrics.clicks > 0 ? metrics.purchases / metrics.clicks : null;
    const cac = metrics.purchases > 0 ? metrics.spend / metrics.purchases : null;
    const roas = metrics.spend > 0 ? metrics.revenue / metrics.spend : null;

    const existing = await this.db.get(
      `
      SELECT * FROM geo_benchmarks WHERE geo = ? AND store = ?
    `,
      [geo, store]
    );

    if (!existing) {
      await this.db.run(
        `
        INSERT INTO geo_benchmarks (geo, store, ctr_avg, atc_rate_avg, ic_rate_avg, cvr_avg, cac_avg, roas_avg, campaigns_count, purchases_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
        [geo, store, ctr, atc_rate, ic_rate, cvr, cac, roas, metrics.purchases]
      );
    } else {
      const n = existing.campaigns_count;
      const newN = n + 1;

      const updateAvg = (old, newVal) => {
        if (newVal == null) return old;
        if (old == null) return newVal;
        return (old * n + newVal) / newN;
      };

      await this.db.run(
        `
        UPDATE geo_benchmarks SET
          ctr_avg = ?,
          atc_rate_avg = ?,
          ic_rate_avg = ?,
          cvr_avg = ?,
          cac_avg = ?,
          roas_avg = ?,
          campaigns_count = ?,
          purchases_total = purchases_total + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE geo = ? AND store = ?
      `,
        [
          updateAvg(existing.ctr_avg, ctr),
          updateAvg(existing.atc_rate_avg, atc_rate),
          updateAvg(existing.ic_rate_avg, ic_rate),
          updateAvg(existing.cvr_avg, cvr),
          updateAvg(existing.cac_avg, cac),
          updateAvg(existing.roas_avg, roas),
          newN,
          metrics.purchases,
          geo,
          store,
        ]
      );
    }

    return { updated: true, geo, campaigns_count: (existing?.campaigns_count || 0) + 1 };
  }

  // --------------------------------------------
  // CREATE ALERT
  // --------------------------------------------
  async createAlert(store, type, severity, data) {
    await this.db.run(
      `
      INSERT INTO intelligence_alerts (store, alert_type, severity, campaign_id, ad_id, geo, title, message, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        store,
        type,
        severity,
        data.campaign_id || null,
        data.ad_id || null,
        data.geo || null,
        data.title,
        data.message,
        JSON.stringify(data),
      ]
    );
  }

  // --------------------------------------------
  // GET ALERTS
  // --------------------------------------------
  async getAlerts(store, limit = 20) {
    return this.db.all(
      `
      SELECT * FROM intelligence_alerts
      WHERE store = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
      [store, limit]
    );
  }

  async getAdSetsForCampaign(campaignId, store) {
    return this.db.all(
      `
      SELECT 
        m.adset_id,
        o.adset_name,
        SUM(m.clicks) as clicks,
        SUM(COALESCE(m.conversions, m.purchases, 0)) as purchases,
        SUM(m.spend) as spend,
        SUM(COALESCE(m.conversion_value, m.purchase_value, 0)) as revenue
      FROM meta_adset_metrics m
      LEFT JOIN meta_objects o ON m.adset_id = o.object_id AND o.object_type = 'adset'
      WHERE m.campaign_id = ? AND m.store = ?
      GROUP BY m.adset_id
    `,
      [campaignId, store]
    );
  }
}
