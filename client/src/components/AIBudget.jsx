
/**
 * AIBudgetSingleFile.jsx
 * Frontend-only React 18 component (single file).
 *
 * Allowed imports: React hooks + lucide-react icons only.
 * Styling: Tailwind CSS.
 *
 * This file merges:
 * - AIBudgetApp.jsx
 * - AIBudgetSimulatorTab.jsx
 * - AIBudgetMathFlowTab.jsx
 * - whatifMath.jsx
 *
 * =====================================================================
 * BACKEND DATA CONTRACT (for your AI coder)
 * =====================================================================
 * The simulator is designed to run with:
 *
 * 1) Platform Data (preferred)
 *    Provide a normalized array of daily rows:
 *      {
 *        date: "YYYY-MM-DD",
 *        brand: "Virona" | "Shawq" | ...,
 *        store: "Salla" | "Shopify" | ... (optional),
 *        campaign_id: string,
 *        campaign_name: string,
 *        adset_id: string (optional but strongly recommended),
 *        adset_name: string (optional),
 *        geo: string (ISO-ish code or your internal country code),
 *        objective: string (optional),
 *
 *        // Cost + outcome (required for any meaningful forecast)
 *        spend: number,
 *        purchases: number,
 *        purchase_value: number,
 *
 *        // Funnel (optional but upgrades confidence + quality adjustment)
 *        impressions?: number,
 *        clicks?: number,
 *        atc?: number,           // Add To Cart (ATC)
 *        ic?: number,            // Initiate Checkout (IC)
 *
 *        // Creative context (optional but upgrades creative adjustment)
 *        active_creatives_count?: number,
 *        new_creatives_7d?: number,
 *        frequency?: number,
 *
 *        // Promo context (optional)
 *        promo_flag?: 0|1,
 *        discount_pct?: number,
 *
 *        // If you can compute this server-side for lookback:
 *        recent_spend_share?: number  // per adset share within campaign for selected lookback
 *      }
 *
 *    MINIMUM REQUIRED COLUMNS TO AVOID "Low-only" MODE:
 *      date, campaign_id OR campaign_name, geo, spend, purchases, purchase_value
 *
 * 2) CSV Override
 *    Users may upload CSV with same schema. This file parses a simple comma CSV.
 *
 * 3) Manual Complements
 *    If platform data missing optional fields, the UI includes "manual complements"
 *    for planned campaigns (AOV, promo, creatives, etc.).
 *
 * =====================================================================
 * KEY DESIGN GOALS
 * =====================================================================
 * - NEVER crash when data is missing.
 * - Show "Data Health" + "Confidence" always.
 * - For standardization, all math uses safeDivide + clamps.
 * - Structure-aware forecasting:
 *      ABO: slider maps to ad set budgets (direct).
 *      CBO/ASC: slider maps to campaign budget -> estimate split -> refine by marginal returns.
 *
 * NOTE:
 * This is a **frontend approximation** of an "elite" simulator.
 * Your backend can later replace estimateParameters() with a proper
 * hierarchical Bayesian model or MMM-like channel curve fitting.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Beaker,
  Brain,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  Cog,
  FileUp,
  Flame,
  Info,
  LineChart,
  ListChecks,
  Rocket,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wand2,
  XCircle
} from "lucide-react";

/* ============================================================================
   MATH UTILITIES
   ============================================================================ */

const MathUtils = {
  safeDivide(n, d, fallback = 0) {
    if (d === 0 || d === null || d === undefined) return fallback;
    if (n === null || n === undefined) return fallback;
    return n / d;
  },

  clamp(min, max, v) {
    return Math.max(min, Math.min(max, v));
  },

  // Simple adstock: current spend + lambda * previous adstock
  computeAdstock(spendArray, lambda = 0.5) {
    const out = [];
    let prev = 0;
    for (let i = 0; i < spendArray.length; i++) {
      const s = Number(spendArray[i] || 0);
      const a = s + lambda * prev;
      out.push(a);
      prev = a;
    }
    return out;
  },

  // Hill saturation: alpha * (X^gamma / (k^gamma + X^gamma))
  hillSaturation(x, alpha, k, gamma = 1) {
    const X = Math.max(0, Number(x || 0));
    const g = Number(gamma || 1);
    const K = Math.max(1e-6, Number(k || 1));
    const A = Math.max(0, Number(alpha || 0));

    const num = Math.pow(X, g);
    const den = Math.pow(K, g) + Math.pow(X, g);
    if (den === 0) return 0;
    return A * (num / den);
  },

  median(arr) {
    const a = (arr || []).filter(v => Number.isFinite(v)).slice().sort((x, y) => x - y);
    if (a.length === 0) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 === 0 ? (a[mid - 1] + a[mid]) / 2 : a[mid];
  },

  iqr(arr) {
    const a = (arr || []).filter(v => Number.isFinite(v)).slice().sort((x, y) => x - y);
    if (a.length < 4) return 0;
    const q1 = a[Math.floor(a.length * 0.25)];
    const q3 = a[Math.floor(a.length * 0.75)];
    return (q3 ?? 0) - (q1 ?? 0);
  },

  // Compute funnel rates from aggregated totals
  computeFunnelRatesAgg(totals) {
    const { impressions, clicks, atc, ic, purchases } = totals || {};
    const ctr = this.safeDivide(clicks, impressions, null);
    const atcr = this.safeDivide(atc, clicks, null); // ATC per click
    const icr = this.safeDivide(ic, atc, null);      // IC per ATC
    const cvr = this.safeDivide(purchases, ic, null); // Purchase per IC
    return { ctr, atcr, icr, cvr };
  },

  // Compute weighted "quality adjustment" vs historical robust stats
  computeQualityAdjustment(currentRates, historicalStats) {
    if (!currentRates || !historicalStats) return 1.0;

    const weights = { ctr: 0.4, atcr: 0.2, icr: 0.2, cvr: 0.2 };
    const zs = [];

    Object.entries(weights).forEach(([k, w]) => {
      const cur = currentRates[k];
      const hist = historicalStats[k];
      if (cur === null || cur === undefined) return;
      if (!hist) return;

      const med = Number(hist.median ?? 0);
      const iqr = Number(hist.iqr ?? 0.01);
      const z = (cur - med) / (iqr + 1e-3);
      zs.push(w * z);
    });

    if (zs.length === 0) return 1.0;
    const Q = zs.reduce((a, b) => a + b, 0);
    // Soft clamp to avoid wild swings
    return this.clamp(0.7, 1.3, 1 + 0.2 * Q);
  },

  // Creative sufficiency ratio:
  // creatives per 1k spend baseline heuristic
  computeCreativeAdjustment(activeCreatives, dailySpend) {
    const k = Math.max(1, Number(activeCreatives || 1));
    const s = Math.max(1, Number(dailySpend || 0));
    const csr = k / Math.max(1, s / 1000); // creatives per ~1k/day
    if (csr >= 1) return 1.0;
    if (csr >= 0.5) return 0.85;
    return 0.7;
  },

  computePromoAdjustment(promoFlag, discountPct) {
    const flag = Number(promoFlag || 0);
    if (!flag) return 1.0;
    const d = Math.max(0, Number(discountPct || 0));
    // Very conservative uplift curve for discount
    return this.clamp(1.0, 1.25, 1 + 0.01 * d);
  },

  // Estimate campaign-level curve parameters from daily rows
  estimateParameters(rows) {
    const data = (rows || []).filter(r => Number(r.spend) > 0 && Number(r.purchase_value) >= 0);
    if (data.length === 0) {
      return { alpha: 6000, k: 3000, gamma: 1.0, lambda: 0.5 };
    }

    // Use spend adstock for stability
    const spends = data.map(d => Number(d.spend || 0));
    const adstocks = this.computeAdstock(spends, 0.5);

    const sorted = adstocks.slice().sort((a, b) => a - b);
    const k = Math.max(100, sorted[Math.floor(sorted.length * 0.7)] || 1000);

    const meanRevenue = data.reduce((s, d) => s + Number(d.purchase_value || 0), 0) / data.length;
    const meanAd = adstocks.reduce((s, a) => s + a, 0) / adstocks.length || 1;

    const alpha = Math.max(100, meanRevenue * (k + meanAd) / Math.max(1, meanAd));

    return { alpha, k, gamma: 1.0, lambda: 0.5 };
  },

  // Global priors for planned campaigns (uses whatever data is available in broader dataset)
  computeGlobalPriors(allRows, geo = null, brand = null) {
    let relevant = (allRows || []).filter(r => Number(r.spend) > 0);

    if (brand) {
      const b = relevant.filter(r => (r.brand || "").toLowerCase() === brand.toLowerCase());
      if (b.length > 0) relevant = b;
    }

    if (geo) {
      const g = relevant.filter(r => (r.geo || "") === geo);
      if (g.length > 0) relevant = g;
    }

    if (relevant.length === 0) {
      return { roas_prior: 3.0, k_prior: 3000, alpha_prior: 18000, gamma_prior: 1.0 };
    }

    const roasArr = relevant
      .map(r => this.safeDivide(Number(r.purchase_value || 0), Number(r.spend || 0), 0))
      .filter(v => v > 0);

    const roas_prior = this.median(roasArr) ?? 3.0;

    const spends = relevant.map(r => Number(r.spend || 0));
    const adstocks = this.computeAdstock(spends, 0.5);
    const k_prior = Math.max(100, this.median(adstocks) ?? 3000);

    const alpha_prior = Math.max(100, 2 * roas_prior * k_prior);

    return { roas_prior, k_prior, alpha_prior, gamma_prior: 1.0 };
  },

  // Predict one day revenue with contextual adjustments
  predictRevenue(dailySpend, params, adjustments = {}) {
    const p = params || {};
    const lambda = Number(p.lambda ?? 0.5);
    const prevAd = Number(adjustments.prevAdstock ?? 0);
    const adstock = Number(dailySpend || 0) + lambda * prevAd;

    const base = this.hillSaturation(adstock, p.alpha, p.k, p.gamma);
    const q = Number(adjustments.qualityAdj ?? 1);
    const c = Number(adjustments.creativeAdj ?? 1);
    const promo = Number(adjustments.promoAdj ?? 1);

    return base * q * c * promo;
  },

  simulateNDays(nDays, dailySpend, params, adjustments = {}) {
    const days = Math.max(1, Number(nDays || 7));
    let prev = 0;
    const daily = [];
    for (let i = 0; i < days; i++) {
      const rev = this.predictRevenue(dailySpend, params, { ...adjustments, prevAdstock: prev });
      const lambda = Number(params?.lambda ?? 0.5);
      prev = Number(dailySpend || 0) + lambda * prev;
      daily.push(rev);
    }
    const total = daily.reduce((s, v) => s + v, 0);
    return { dailyRevenues: daily, total, avgDaily: total / daily.length };
  },

  // Lightweight uncertainty: bootstrap parameter re-estimation
  computeUncertaintyBand(rows, dailySpend) {
    const data = (rows || []).filter(r => Number(r.spend) > 0);
    if (data.length < 7) {
      const params = this.estimateParameters(data);
      const mean = this.predictRevenue(dailySpend, params);
      return { mean, p10: mean * 0.7, p90: mean * 1.3 };
    }

    const resamples = Math.min(40, data.length);
    const preds = [];

    for (let i = 0; i < resamples; i++) {
      const sample = [];
      for (let j = 0; j < data.length; j++) {
        sample.push(data[Math.floor(Math.random() * data.length)]);
      }
      const p = this.estimateParameters(sample);
      preds.push(this.predictRevenue(dailySpend, p));
    }

    preds.sort((a, b) => a - b);
    const p10 = preds[Math.floor(preds.length * 0.1)] ?? preds[0];
    const p90 = preds[Math.floor(preds.length * 0.9)] ?? preds[preds.length - 1];
    const mean = preds.reduce((s, v) => s + v, 0) / preds.length;

    return { mean, p10, p90 };
  }
};

/* ============================================================================
   DATA VALIDATION + HEALTH
   ============================================================================ */

const DataValidator = {
  // CSV rows are objects keyed by header strings
  validateCSV(rows) {
    const required = ["date", "geo", "spend", "purchases", "purchase_value"];
    const optional = [
      "brand", "campaign_id", "campaign_name", "adset_id", "adset_name",
      "impressions", "clicks", "atc", "ic",
      "frequency",
      "active_creatives_count", "new_creatives_7d",
      "promo_flag", "discount_pct",
      "recent_spend_share"
    ];

    if (!rows || rows.length === 0) return { valid: false, error: "CSV is empty." };

    const headers = Object.keys(rows[0] || {});
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length) {
      return { valid: false, error: `Missing required columns: ${missing.join(", ")}` };
    }

    const availableOptional = optional.filter(o => headers.includes(o));

    const parsed = rows.map(r => ({
      ...r,
      spend: Number(r.spend || 0),
      purchases: Number(r.purchases || 0),
      purchase_value: Number(r.purchase_value || 0),
      impressions: r.impressions !== undefined ? Number(r.impressions || 0) : undefined,
      clicks: r.clicks !== undefined ? Number(r.clicks || 0) : undefined,
      atc: r.atc !== undefined ? Number(r.atc || 0) : undefined,
      ic: r.ic !== undefined ? Number(r.ic || 0) : undefined,
      frequency: r.frequency !== undefined ? Number(r.frequency || 0) : undefined,
      active_creatives_count: r.active_creatives_count !== undefined ? Number(r.active_creatives_count || 0) : undefined,
      new_creatives_7d: r.new_creatives_7d !== undefined ? Number(r.new_creatives_7d || 0) : undefined,
      promo_flag: r.promo_flag !== undefined ? Number(r.promo_flag || 0) : undefined,
      discount_pct: r.discount_pct !== undefined ? Number(r.discount_pct || 0) : undefined,
      recent_spend_share: r.recent_spend_share !== undefined ? Number(r.recent_spend_share || 0) : undefined
    }));

    return { valid: true, required, availableOptional, rows: parsed };
  },

  computeDataHealth(rows, mode) {
    const data = rows || [];
    const coverageDays = data.length;
    const activeSpendDays = data.filter(r => Number(r.spend) > 0).length;

    const hasBasics = data.every(r =>
      r.spend !== undefined && r.purchase_value !== undefined && r.purchases !== undefined
    );

    const hasFunnel = data.some(r =>
      Number(r.impressions) > 0 && Number(r.clicks) > 0 &&
      (r.atc !== undefined) && (r.ic !== undefined)
    );

    const missing = [];
    if (!hasFunnel) missing.push("Funnel metrics (impressions, clicks, ATC, IC)");

    let readiness = "🚫 Insufficient data";
    let confidence = "Low";

    if (mode === "planned") {
      readiness = "✅ Ready (Pre-launch)";
      confidence = "Low";
      if (coverageDays === 0) missing.push("No historical data found — will use global priors.");
    } else {
      if (coverageDays >= 14 && activeSpendDays >= 10 && hasBasics) {
        readiness = "✅ Full model";
        confidence = hasFunnel ? "High" : "Medium";
      } else if (coverageDays >= 7 && hasBasics) {
        readiness = "🟡 Partial model";
        confidence = "Medium";
        const daysNeeded = Math.max(0, 14 - coverageDays);
        if (daysNeeded) missing.push(`Add ~${daysNeeded} more days for stronger curve fitting`);
      } else {
        missing.push("Need at least ~7 days with spend + purchases + revenue");
      }
    }

    return {
      source: coverageDays ? "Platform / CSV" : "None",
      coverageDays,
      activeSpendDays,
      readiness,
      confidence,
      missingColumns: missing,
      hasFunnel
    };
  }
};

/* ============================================================================
   MOCK DATA (for demo)
   ============================================================================ */

const MockData = {
  brands: ["Virona", "Shawq"],
  geos: ["SA", "AE", "KW", "QA", "OM", "BH", "US", "UK", "DE", "FR"],

  campaigns: [
    { id: "c1", name: "Virona KSA - Prospecting", brand: "Virona", geo: "SA" },
    { id: "c2", name: "Virona KSA - Retargeting 30D", brand: "Virona", geo: "SA" },
    { id: "c3", name: "Shawq US - Prospecting", brand: "Shawq", geo: "US" },
    { id: "c4", name: "Shawq US - Retargeting 14D", brand: "Shawq", geo: "US" }
  ],

  adsetsByCampaign: {
    c1: [
      { id: "a1", name: "Broad Men 18–44" },
      { id: "a2", name: "Interests - Heritage" },
      { id: "a3", name: "LAL 1%" }
    ],
    c2: [
      { id: "a4", name: "Website Visitors 30D" },
      { id: "a5", name: "ATC 14D" }
    ],
    c3: [
      { id: "a6", name: "Broad US 18–44" },
      { id: "a7", name: "Interests - Streetwear" }
    ],
    c4: [
      { id: "a8", name: "Warm 14D" }
    ]
  },

  // Generate daily mock rows for a campaign (with adset split)
  generateCampaignRows(campaign, days = 30) {
    const adsets = this.adsetsByCampaign[campaign.id] || [];
    const data = [];
    const baseSpend = campaign.brand === "Virona" ? 4500 : 2200;
    const baseROAS = campaign.brand === "Virona" ? 3.2 : 2.6;

    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000);
      const daySpend = baseSpend * (0.75 + Math.random() * 0.5);
      const dayRev = daySpend * baseROAS * (0.85 + Math.random() * 0.3);

      // Split across adsets with noisy shares
      const shares = adsets.length
        ? adsets.map(() => 0.5 + Math.random())
        : [1];
      const sum = shares.reduce((s, v) => s + v, 0);
      const normShares = shares.map(s => s / sum);

      (adsets.length ? adsets : [{ id: "na", name: "Campaign Aggregate" }]).forEach((adset, idx) => {
        const spend = daySpend * (normShares[idx] || 1);
        const purchase_value = dayRev * (normShares[idx] || 1);

        const impressions = Math.floor(spend * 70);
        const clicks = Math.floor(impressions * (0.012 + Math.random() * 0.01));
        const atc = Math.floor(clicks * (0.18 + Math.random() * 0.12));
        const ic = Math.floor(atc * (0.55 + Math.random() * 0.15));
        const purchases = Math.max(0, Math.floor(ic * (0.35 + Math.random() * 0.15)));

        data.push({
          date: date.toISOString().slice(0, 10),
          brand: campaign.brand,
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          adset_id: adset.id,
          adset_name: adset.name,
          geo: campaign.geo,
          spend,
          purchases,
          purchase_value,
          impressions,
          clicks,
          atc,
          ic,
          active_creatives_count: 3 + Math.floor(Math.random() * 4),
          new_creatives_7d: Math.random() < 0.3 ? 1 : 0,
          promo_flag: i % 14 < 2 ? 1 : 0,
          discount_pct: i % 14 < 2 ? 15 : 0
        });
      });
    }

    return data;
  },

  generateAllRows(days = 30) {
    let all = [];
    this.campaigns.forEach(c => {
      all = all.concat(this.generateCampaignRows(c, days));
    });
    return all;
  }
};

/* ============================================================================
   LOOKBACK HELPERS
   ============================================================================ */

const LOOKBACK_OPTIONS = [
  { key: "smart", label: "🧠 Smart (recommended)" },
  { key: "14", label: "14D" },
  { key: "30", label: "30D" },
  { key: "90", label: "90D" },
  { key: "full", label: "Full History" }
];

function chooseSmartLookback(rows) {
  const days = rows?.length || 0;
  if (days >= 90) return 30;
  if (days >= 30) return 14;
  if (days >= 14) return 14;
  if (days >= 7) return 7;
  return Math.max(0, days);
}

function applyLookback(rows, lookbackKey) {
  const data = rows || [];
  if (lookbackKey === "full") return data;

  if (lookbackKey === "smart") {
    const lb = chooseSmartLookback(data);
    return data.slice(-lb);
  }

  const n = Number(lookbackKey);
  if (!Number.isFinite(n) || n <= 0) return data;
  return data.slice(-n);
}

/* ============================================================================
   AGGREGATION HELPERS
   ============================================================================ */

function aggregateTotals(rows) {
  const totals = {
    spend: 0, purchases: 0, purchase_value: 0,
    impressions: 0, clicks: 0, atc: 0, ic: 0
  };
  (rows || []).forEach(r => {
    totals.spend += Number(r.spend || 0);
    totals.purchases += Number(r.purchases || 0);
    totals.purchase_value += Number(r.purchase_value || 0);
    if (r.impressions !== undefined) totals.impressions += Number(r.impressions || 0);
    if (r.clicks !== undefined) totals.clicks += Number(r.clicks || 0);
    if (r.atc !== undefined) totals.atc += Number(r.atc || 0);
    if (r.ic !== undefined) totals.ic += Number(r.ic || 0);
  });
  return totals;
}

function computeHistoricalFunnelStats(rows) {
  // Build distributions of daily rates
  const ctrArr = [];
  const atcrArr = [];
  const icrArr = [];
  const cvrArr = [];

  (rows || []).forEach(r => {
    const impressions = Number(r.impressions || 0);
    const clicks = Number(r.clicks || 0);
    const atc = Number(r.atc || 0);
    const ic = Number(r.ic || 0);
    const purchases = Number(r.purchases || 0);

    const ctr = MathUtils.safeDivide(clicks, impressions, null);
    const atcr = MathUtils.safeDivide(atc, clicks, null);
    const icr = MathUtils.safeDivide(ic, atc, null);
    const cvr = MathUtils.safeDivide(purchases, ic, null);

    if (ctr !== null) ctrArr.push(ctr);
    if (atcr !== null) atcrArr.push(atcr);
    if (icr !== null) icrArr.push(icr);
    if (cvr !== null) cvrArr.push(cvr);
  });

  return {
    ctr: { median: MathUtils.median(ctrArr) ?? 0, iqr: MathUtils.iqr(ctrArr) ?? 0.01 },
    atcr: { median: MathUtils.median(atcrArr) ?? 0, iqr: MathUtils.iqr(atcrArr) ?? 0.01 },
    icr: { median: MathUtils.median(icrArr) ?? 0, iqr: MathUtils.iqr(icrArr) ?? 0.01 },
    cvr: { median: MathUtils.median(cvrArr) ?? 0, iqr: MathUtils.iqr(cvrArr) ?? 0.01 }
  };
}

/* ============================================================================
   STRUCTURE-AWARE ALLOCATION
   ============================================================================ */

/**
 * Estimate base ad set shares for CBO/ASC.
 *
 * Priority order:
 * 1) Use recent_spend_share if provided (server-side recommended).
 * 2) Compute shares from selected lookback adset spend.
 * 3) Fallback: equal split.
 */
function estimateBaseShares(rows, adsets) {
  const as = adsets || [];
  if (as.length === 0) return [];

  // If server-side shares exist at row-level, we can take last non-null by adset
  const hasServerShares = (rows || []).some(r => r.recent_spend_share !== undefined);
  if (hasServerShares) {
    const latestByAdset = {};
    (rows || []).forEach(r => {
      if (!r.adset_id) return;
      if (r.recent_spend_share === undefined) return;
      latestByAdset[r.adset_id] = Number(r.recent_spend_share || 0);
    });
    const shares = as.map(a => Math.max(0, latestByAdset[a.id] ?? 0));
    const sum = shares.reduce((s, v) => s + v, 0);
    if (sum > 0) return shares.map(s => s / sum);
  }

  // Compute spend shares from lookback data
  const spendByAdset = {};
  (rows || []).forEach(r => {
    if (!r.adset_id) return;
    spendByAdset[r.adset_id] = (spendByAdset[r.adset_id] || 0) + Number(r.spend || 0);
  });

  const shares = as.map(a => Math.max(0, spendByAdset[a.id] ?? 0));
  const sum = shares.reduce((s, v) => s + v, 0);
  if (sum > 0) return shares.map(s => s / sum);

  // Equal fallback
  return as.map(() => 1 / as.length);
}

/**
 * Compute a "marginal return score" per adset using a light curve proxy.
 * We reuse campaign-level parameters as a fallback.
 *
 * Backend upgrade path:
 * - Fit per-adset parameters using per-adset daily history.
 * - Replace this scorer with true dRevenue/dSpend at current spend.
 */
function computeMarginalScores(adsetRowsMap, paramsByAdset, candidateDailyBudgets) {
  const scores = [];

  Object.keys(adsetRowsMap).forEach((adsetId, idx) => {
    const rows = adsetRowsMap[adsetId] || [];
    const params = paramsByAdset[adsetId] || MathUtils.estimateParameters(rows);
    const spend = Number(candidateDailyBudgets[idx] || 0);

    // Approximate marginal return by finite difference
    const delta = Math.max(50, spend * 0.05);
    const base = MathUtils.predictRevenue(spend, params);
    const up = MathUtils.predictRevenue(spend + delta, params);
    const marginal = MathUtils.safeDivide(up - base, delta, 0);

    scores.push(Math.max(0.001, marginal));
  });

  return scores;
}

/**
 * Refine base shares based on predicted marginal returns.
 * - Start with base shares.
 * - Create implied budgets.
 * - Score marginal returns.
 * - Blend into a new share vector.
 */
function refineSharesByMarginal({
  baseShares,
  campaignDailyBudget,
  adsetRowsMap,
  paramsByAdset
}) {
  const n = baseShares.length;
  if (n === 0) return [];

  const impliedBudgets = baseShares.map(s => s * campaignDailyBudget);

  const adsetIds = Object.keys(adsetRowsMap);
  const scores = computeMarginalScores(adsetRowsMap, paramsByAdset, impliedBudgets);

  const scoreSum = scores.reduce((s, v) => s + v, 0) || 1;
  const scoreShares = scores.map(s => s / scoreSum);

  // Blend: keep stability but allow "intelligent shift"
  const blended = baseShares.map((b, i) => 0.6 * b + 0.4 * (scoreShares[i] ?? b));
  const sum = blended.reduce((s, v) => s + v, 0) || 1;

  return blended.map(s => s / sum);
}

/* ============================================================================
   MODEL OPTIONS (educational + auto-choice)
   ============================================================================ */

const MODEL_OPTIONS = [
  {
    key: "auto",
    title: "🧠 Auto (Scenario-fit)",
    subtitle: "Chooses the best math mode for your structure + data health"
  },
  {
    key: "max_roas",
    title: "🏆 Recommended (Max ROAS)",
    subtitle: "Finds a conservative sweet spot where incremental returns are strongest"
  },
  {
    key: "growth_knee",
    title: "🚀 Recommended (Growth Knee)",
    subtitle: "Targets the knee of the curve for faster scale with controlled efficiency"
  },
  {
    key: "conservative",
    title: "🛡️ Conservative",
    subtitle: "Allocates with heavier risk penalties and wider uncertainty"
  },
  {
    key: "aggressive",
    title: "🔥 Aggressive",
    subtitle: "Assumes stronger learning + creative depth; higher variance"
  }
];

// Heuristic model selection based on scenario
function pickAutoModelKey({ mode, geoMaturity, structure, dataHealth }) {
  if (mode === "planned") {
    return geoMaturity === "new" ? "conservative" : "growth_knee";
  }
  if (dataHealth.confidence === "Low") return "conservative";
  if (structure === "ABO") return "growth_knee";
  return "max_roas";
}

/* ============================================================================
   BUDGET RECOMMENDERS (Max ROAS vs Growth Knee)
   ============================================================================ */

/**
 * We solve recommendations by scanning a spend grid.
 * Backend upgrade path:
 * - Use analytic derivative of Hill curve with adjustments
 * - Or gradient search / Bayesian optimization.
 */
function recommendBudgets({
  structure,
  paramsCampaign,
  adsetParamsMap,
  adsetRowsMap,
  baseShares,
  refinedShares,
  adjustments,
  minSpend = 500,
  maxSpend = 20000,
  step = 250
}) {
  // For simplicity, recommendations are computed at campaign-level spend.
  // For ABO, this is still a "total daily budget guidance" that you can
  // distribute across ad sets using existing split logic.

  const candidates = [];
  for (let s = minSpend; s <= maxSpend; s += step) {
    const predicted = predictStructureAwareRevenue({
      structure,
      campaignDailyBudget: s,
      paramsCampaign,
      adsetParamsMap,
      adsetRowsMap,
      baseShares,
      refinedShares,
      adjustments
    });

    const roas = MathUtils.safeDivide(predicted.meanDailyRevenue, s, 0);
    candidates.push({ spend: s, roas, revenue: predicted.meanDailyRevenue });
  }

  if (candidates.length === 0) return null;

  // Max ROAS point (but avoid tiny spends by applying mild floor preference)
  let bestRoas = candidates[0];
  candidates.forEach(c => {
    const floorBonus = c.spend >= 1500 ? 1.0 : 0.98;
    if (c.roas * floorBonus > bestRoas.roas * (bestRoas.spend >= 1500 ? 1.0 : 0.98)) {
      bestRoas = c;
    }
  });

  // Growth knee:
  // Find point where marginal ROAS drop crosses a threshold
  // Approach: compute delta revenue per delta spend between grid points.
  let knee = candidates[Math.floor(candidates.length * 0.35)] || bestRoas;
  for (let i = 1; i < candidates.length; i++) {
    const prev = candidates[i - 1];
    const cur = candidates[i];
    const dSpend = cur.spend - prev.spend;
    const dRev = cur.revenue - prev.revenue;
    const marginalRoas = MathUtils.safeDivide(dRev, dSpend, 0);
    // Heuristic knee threshold: marginal ROAS falls near ~70% of best ROAS
    if (marginalRoas > 0 && marginalRoas <= bestRoas.roas * 0.7) {
      knee = cur;
      break;
    }
  }

  return { maxRoas: bestRoas, growthKnee: knee, grid: candidates };
}

/* ============================================================================
   STRUCTURE-AWARE REVENUE PREDICTOR
   ============================================================================ */

/**
 * Predict mean daily revenue given:
 * - structure: "ABO" | "CBO" | "ASC"
 * - campaignDailyBudget
 *
 * Logic:
 * - ABO: if ad sets exist, allocate using base shares (or equal) to estimate total.
 * - CBO/ASC:
 *    1) base shares from history or equal
 *    2) refine shares by marginal returns
 *    3) sum adset-level predictions
 *
 * Notes:
 * - This uses adset-specific params if available, else estimates from each adset's rows.
 * - When adsetRows missing, fall back to campaign-level params.
 */
function predictStructureAwareRevenue({
  structure,
  campaignDailyBudget,
  paramsCampaign,
  adsetParamsMap,
  adsetRowsMap,
  baseShares,
  refinedShares,
  adjustments
}) {
  const budget = Number(campaignDailyBudget || 0);
  const struct = structure || "CBO";

  const adsetIds = Object.keys(adsetRowsMap || {});
  const hasAdsets = adsetIds.length > 0;

  // No adsets available => campaign-level prediction only.
  if (!hasAdsets) {
    const mean = MathUtils.predictRevenue(budget, paramsCampaign, adjustments);
    return { meanDailyRevenue: mean, adsetBreakdown: [] };
  }

  const sharesToUse = (struct === "CBO" || struct === "ASC")
    ? (refinedShares?.length ? refinedShares : baseShares)
    : (baseShares?.length ? baseShares : adsetIds.map(() => 1 / adsetIds.length));

  const breakdown = [];
  let total = 0;

  adsetIds.forEach((adsetId, idx) => {
    const s = sharesToUse[idx] ?? (1 / adsetIds.length);
    const adsetBudget = budget * s;

    const params = adsetParamsMap?.[adsetId]
      || MathUtils.estimateParameters(adsetRowsMap[adsetId] || []);

    const rev = MathUtils.predictRevenue(adsetBudget, params, adjustments);
    total += rev;

    breakdown.push({
      adset_id: adsetId,
      share: s,
      budget: adsetBudget,
      revenue: rev
    });
  });

  return { meanDailyRevenue: total, adsetBreakdown: breakdown };
}

/* ============================================================================
   UI COMPONENTS
   ============================================================================ */

function Pill({ active, onClick, children, subtle }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
        subtle ? "border" : "",
        active
          ? "bg-indigo-600 text-white shadow-sm"
          : subtle
            ? "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      ].join(" ")}
      type="button"
    >
      {children}
    </button>
  );
}

function SectionCard({ title, icon, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      <div className="px-6 pt-6 pb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-50">
          {icon}
        </span>
        <h3 className="text-sm font-bold text-gray-900 tracking-wide">{title}</h3>
      </div>
      <div className="px-6 pb-6">{children}</div>
    </div>
  );
}

function MiniStat({ label, value, tone = "default" }) {
  const color =
    tone === "good" ? "text-green-600" :
    tone === "warn" ? "text-yellow-600" :
    tone === "bad" ? "text-red-600" :
    "text-gray-900";

  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function ConfidenceBadge({ level }) {
  const l = level || "Low";
  const cls =
    l === "High" ? "bg-green-50 text-green-700 border-green-200" :
    l === "Medium" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
    "bg-red-50 text-red-700 border-red-200";

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${cls}`}>
      {l === "High" ? <CircleCheck size={12} /> : l === "Medium" ? <Info size={12} /> : <ShieldAlert size={12} />}
      {l}
    </span>
  );
}

/* ============================================================================
   SIMULATOR TAB
   ============================================================================ */

function AIBudgetSimulatorTab({ platformRows }) {
  // ------------------------------
  // PRIMARY STATE
  // ------------------------------
  const [scenarioMode, setScenarioMode] = useState("existing"); // existing | planned
  const [geoMaturity, setGeoMaturity] = useState("mature"); // mature | new
  const [brand, setBrand] = useState("Virona");

  const [structure, setStructure] = useState("CBO"); // ABO | CBO | ASC (user always picks)
  const [lookbackKey, setLookbackKey] = useState("smart");

  const [selectedCampaignId, setSelectedCampaignId] = useState(MockData.campaigns[0].id);

  const [dailyBudget, setDailyBudget] = useState(5000);

  const [modelKey, setModelKey] = useState("auto");
  const [showModelHelp, setShowModelHelp] = useState(false);

  const [showSanity, setShowSanity] = useState(false);

  // CSV override
  const [csvData, setCSVData] = useState(null);
  const [uploadError, setUploadError] = useState("");

  // Planned campaign manual inputs
  const [plannedInputs, setPlannedInputs] = useState({
    campaign_name: "",
    geo: "SA",
    audienceType: "Broad",
    campaignType: "Prospecting",
    expectedAOV: 150,
    promoFlag: 0,
    discountPct: 0,
    activeCreatives: 3,
    newCreativesPerWeek: 1
  });

  // ------------------------------
  // SOURCE DATA SETUP
  // ------------------------------

  const allRows = useMemo(() => {
    if (platformRows && platformRows.length) return platformRows;
    // Demo fallback
    return MockData.generateAllRows(30);
  }, [platformRows]);

  const campaignsByBrand = useMemo(() => {
    const uniqMap = new Map();
    (allRows || []).forEach(r => {
      const cid = r.campaign_id || r.campaign_name || "unknown";
      if (!uniqMap.has(cid)) {
        uniqMap.set(cid, {
          id: r.campaign_id || cid,
          name: r.campaign_name || cid,
          brand: r.brand || brand,
          geo: r.geo || "NA"
        });
      }
    });

    const list = Array.from(uniqMap.values())
      .filter(c => (c.brand || "").toLowerCase() === brand.toLowerCase());

    // If no platform campaigns detected for chosen brand, fallback to mock
    return list.length ? list : MockData.campaigns.filter(c => c.brand === brand);
  }, [allRows, brand]);

  // Selected campaign object
  const selectedCampaign = useMemo(() => {
    const found = campaignsByBrand.find(c => c.id === selectedCampaignId);
    return found || campaignsByBrand[0] || MockData.campaigns[0];
  }, [campaignsByBrand, selectedCampaignId]);

  // Campaign rows filtered
  const campaignRowsRaw = useMemo(() => {
    if (!selectedCampaign) return [];
    return (allRows || []).filter(r =>
      (r.campaign_id && r.campaign_id === selectedCampaign.id) ||
      (!r.campaign_id && r.campaign_name === selectedCampaign.name)
    );
  }, [allRows, selectedCampaign]);

  // Apply CSV override:
  // - If CSV loaded, it *replaces* campaign rows for simulation.
  const campaignRowsSource = useMemo(() => {
    if (csvData?.valid) return csvData.rows;
    return campaignRowsRaw;
  }, [csvData, campaignRowsRaw]);

  // Apply lookback after source selection
  const lookbackRows = useMemo(() => applyLookback(campaignRowsSource, lookbackKey), [campaignRowsSource, lookbackKey]);

  const smartLookbackUsed = useMemo(() => {
    if (lookbackKey !== "smart") return null;
    return chooseSmartLookback(campaignRowsSource);
  }, [lookbackKey, campaignRowsSource]);

  // Group rows by adset
  const adsetsForCampaign = useMemo(() => {
    // Derive adsets from data
    const map = new Map();
    (campaignRowsSource || []).forEach(r => {
      if (!r.adset_id && !r.adset_name) return;
      const id = r.adset_id || r.adset_name;
      if (!map.has(id)) map.set(id, { id, name: r.adset_name || id });
    });

    const list = Array.from(map.values());
    if (list.length) return list;

    // Demo fallback
    if (selectedCampaign?.id && MockData.adsetsByCampaign[selectedCampaign.id]) {
      return MockData.adsetsByCampaign[selectedCampaign.id];
    }
    return [];
  }, [campaignRowsSource, selectedCampaign]);

  const adsetRowsMap = useMemo(() => {
    const map = {};
    adsetsForCampaign.forEach(a => { map[a.id] = []; });

    (lookbackRows || []).forEach(r => {
      const id = r.adset_id || r.adset_name;
      if (!id) return;
      if (!map[id]) map[id] = [];
      map[id].push(r);
    });

    // If no adset rows but we still want structure logic, create one aggregate bucket
    if (Object.keys(map).length === 0 && (lookbackRows || []).length) {
      map["campaign_aggregate"] = lookbackRows;
    }

    return map;
  }, [lookbackRows, adsetsForCampaign]);

  // Params:
  const paramsCampaign = useMemo(() => MathUtils.estimateParameters(lookbackRows), [lookbackRows]);

  const adsetParamsMap = useMemo(() => {
    const map = {};
    Object.keys(adsetRowsMap).forEach(id => {
      map[id] = MathUtils.estimateParameters(adsetRowsMap[id]);
    });
    return map;
  }, [adsetRowsMap]);

  // Base shares (from lookbackRows)
  const baseShares = useMemo(() => {
    const adsets = adsetsForCampaign.length
      ? adsetsForCampaign
      : Object.keys(adsetRowsMap).map(id => ({ id, name: id }));

    return estimateBaseShares(lookbackRows, adsets);
  }, [lookbackRows, adsetsForCampaign, adsetsRowsMapKey(adsetsForCampaign)]);

  // Helper to avoid memo issues with array identity
  function adsetsRowsMapKey(list) {
    return (list || []).map(a => a.id).join("|");
  }

  // Refined shares for CBO/ASC
  const refinedShares = useMemo(() => {
    if (structure === "ABO") return baseShares;
    const adsetIds = Object.keys(adsetRowsMap);
    if (adsetIds.length === 0) return baseShares;

    const localMap = {};
    adsetIds.forEach(id => { localMap[id] = adsetRowsMap[id]; });

    return refineSharesByMarginal({
      baseShares,
      campaignDailyBudget: dailyBudget,
      adsetRowsMap: localMap,
      paramsByAdset: adsetParamsMap
    });
  }, [structure, baseShares, dailyBudget, adsetRowsMap, adsetParamsMap]);

  // ------------------------------
  // FUNNEL + CONTEXT ADJUSTMENTS
  // ------------------------------

  const lastRow = useMemo(() => {
    const rows = lookbackRows || [];
    return rows.length ? rows[rows.length - 1] : null;
  }, [lookbackRows]);

  const totals = useMemo(() => aggregateTotals(lookbackRows), [lookbackRows]);

  const currentRates = useMemo(() => MathUtils.computeFunnelRatesAgg(totals), [totals]);

  const histFunnelStats = useMemo(() => computeHistoricalFunnelStats(lookbackRows), [lookbackRows]);

  const qualityAdj = useMemo(
    () => MathUtils.computeQualityAdjustment(currentRates, histFunnelStats),
    [currentRates, histFunnelStats]
  );

  const creativeAdj = useMemo(() => {
    const active = scenarioMode === "planned"
      ? plannedInputs.activeCreatives
      : (lastRow?.active_creatives_count ?? 3);
    return MathUtils.computeCreativeAdjustment(active, dailyBudget);
  }, [scenarioMode, plannedInputs.activeCreatives, lastRow, dailyBudget]);

  const promoAdj = useMemo(() => {
    if (scenarioMode === "planned") {
      return MathUtils.computePromoAdjustment(plannedInputs.promoFlag, plannedInputs.discountPct);
    }
    return MathUtils.computePromoAdjustment(lastRow?.promo_flag, lastRow?.discount_pct);
  }, [scenarioMode, plannedInputs.promoFlag, plannedInputs.discountPct, lastRow]);

  const adjustments = useMemo(() => ({ qualityAdj, creativeAdj, promoAdj }), [qualityAdj, creativeAdj, promoAdj]);

  // ------------------------------
  // DATA HEALTH
  // ------------------------------

  const dataHealth = useMemo(
    () => DataValidator.computeDataHealth(lookbackRows, scenarioMode),
    [lookbackRows, scenarioMode]
  );

  // ------------------------------
  // MODEL AUTO-CHOICE & RECOMMENDERS
  // ------------------------------

  const autoModelKey = useMemo(
    () => pickAutoModelKey({ mode: scenarioMode, geoMaturity, structure, dataHealth }),
    [scenarioMode, geoMaturity, structure, dataHealth]
  );

  const effectiveModelKey = modelKey === "auto" ? autoModelKey : modelKey;

  const modelBehaviorTweak = useMemo(() => {
    // Small multipliers to represent risk appetite.
    // You can refine these server-side later.
    switch (effectiveModelKey) {
      case "conservative":
        return { q: 0.98, c: 0.95, promo: 0.98, uncertaintyWiden: 1.15 };
      case "aggressive":
        return { q: 1.02, c: 1.05, promo: 1.02, uncertaintyWiden: 0.95 };
      case "growth_knee":
        return { q: 1.0, c: 1.0, promo: 1.0, uncertaintyWiden: 1.0 };
      case "max_roas":
        return { q: 1.0, c: 1.0, promo: 1.0, uncertaintyWiden: 1.0 };
      default:
        return { q: 1.0, c: 1.0, promo: 1.0, uncertaintyWiden: 1.0 };
    }
  }, [effectiveModelKey]);

  const adjustedAdjustments = useMemo(() => ({
    qualityAdj: adjustments.qualityAdj * modelBehaviorTweak.q,
    creativeAdj: adjustments.creativeAdj * modelBehaviorTweak.c,
    promoAdj: adjustments.promoAdj * modelBehaviorTweak.promo
  }), [adjustments, modelBehaviorTweak]);

  // For planned mode with no history, use global priors
  const plannedParamsOverride = useMemo(() => {
    if (scenarioMode !== "planned") return null;
    const priors = MathUtils.computeGlobalPriors(allRows, plannedInputs.geo, brand);
    return { alpha: priors.alpha_prior, k: priors.k_prior, gamma: priors.gamma_prior, lambda: 0.5 };
  }, [scenarioMode, allRows, plannedInputs.geo, brand]);

  // Structure-aware daily revenue prediction
  const prediction = useMemo(() => {
    const pCampaign = scenarioMode === "planned" ? (plannedParamsOverride || paramsCampaign) : paramsCampaign;

    const result = predictStructureAwareRevenue({
      structure,
      campaignDailyBudget: dailyBudget,
      paramsCampaign: pCampaign,
      adsetParamsMap,
      adsetRowsMap,
      baseShares,
      refinedShares,
      adjustments: adjustedAdjustments
    });

    // Uncertainty computed at campaign-level for now
    const band = MathUtils.computeUncertaintyBand(lookbackRows, dailyBudget);
    const widen = modelBehaviorTweak.uncertaintyWiden;

    const mean = result.meanDailyRevenue;
    const p10 = Math.min(mean, band.p10) * widen;
    const p90 = Math.max(mean, band.p90) * widen;

    const roas = MathUtils.safeDivide(mean, dailyBudget, 0);

    return {
      mean,
      p10,
      p90,
      roas,
      adsetBreakdown: result.adsetBreakdown
    };
  }, [
    scenarioMode,
    plannedParamsOverride,
    paramsCampaign,
    structure,
    dailyBudget,
    adsetParamsMap,
    adsetRowsMap,
    baseShares,
    refinedShares,
    adjustedAdjustments,
    lookbackRows,
    modelBehaviorTweak
  ]);

  // Budget recommender grid
  const recommendations = useMemo(() => {
    const pCampaign = scenarioMode === "planned" ? (plannedParamsOverride || paramsCampaign) : paramsCampaign;
    return recommendBudgets({
      structure,
      paramsCampaign: pCampaign,
      adsetParamsMap,
      adsetRowsMap,
      baseShares,
      refinedShares,
      adjustments: adjustedAdjustments
    });
  }, [
    scenarioMode,
    plannedParamsOverride,
    paramsCampaign,
    structure,
    adsetParamsMap,
    adsetRowsMap,
    baseShares,
    refinedShares,
    adjustedAdjustments
  ]);

  // ------------------------------
  // CSV HANDLER
  // ------------------------------

  const handleCSVUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target.result || "");
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) {
          setUploadError("CSV appears too small.");
          setCSVData(null);
          return;
        }

        const headers = lines[0].split(",").map(h => h.trim());
        const rows = lines.slice(1).map(line => {
          const values = line.split(",");
          const row = {};
          headers.forEach((h, i) => row[h] = values[i]?.trim() ?? "");
          return row;
        });

        const validation = DataValidator.validateCSV(rows);
        if (!validation.valid) {
          setUploadError(validation.error);
          setCSVData(null);
          return;
        }
        setCSVData(validation);
        setUploadError("");
      } catch (err) {
        setUploadError(`Failed to parse CSV: ${err?.message || "Unknown error"}`);
        setCSVData(null);
      }
    };
    reader.readAsText(file);
  };

  const clearCSV = () => {
    setCSVData(null);
    setUploadError("");
  };

  // ------------------------------
  // UI HELPERS
  // ------------------------------

  const confidenceLevel = dataHealth.confidence;

  const modelExplanation = useMemo(() => {
    const chosen = MODEL_OPTIONS.find(m => m.key === effectiveModelKey);
    const others = MODEL_OPTIONS.filter(m => m.key !== effectiveModelKey && m.key !== "auto");

    const whyChosen = [];
    if (scenarioMode === "planned") {
      whyChosen.push("Planned scenario needs conservative priors + explicit uncertainty handling.");
      if (geoMaturity === "new") whyChosen.push("New geo increases variance; safer budget sweet spots matter.");
    } else {
      whyChosen.push("Existing data allows curve fitting and structure-aware allocation.");
      if (confidenceLevel === "High") whyChosen.push("High data confidence supports stronger recommendations.");
      if (structure !== "ABO") whyChosen.push("CBO/ASC benefit from marginal-return reallocation logic.");
    }

    return { chosen, others, whyChosen };
  }, [effectiveModelKey, scenarioMode, geoMaturity, confidenceLevel, structure]);

  // ------------------------------
  // RENDER
  // ------------------------------

  return (
    <div className="space-y-6">
      {/* TOP: Scenario + Brand */}
      <SectionCard
        title="Scenario Assistant"
        icon={<Wand2 size={16} className="text-indigo-600" />}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500">Brand</div>
            <div className="flex flex-wrap gap-2">
              {MockData.brands.map(b => (
                <Pill
                  key={b}
                  active={brand === b}
                  onClick={() => setBrand(b)}
                >
                  {b === "Virona" ? "🧿 Virona" : "🧵 Shawq"}
                </Pill>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500">Campaign Type</div>
            <div className="flex flex-wrap gap-2">
              <Pill active={scenarioMode === "existing"} onClick={() => setScenarioMode("existing")}>
                📌 Existing Campaign
              </Pill>
              <Pill active={scenarioMode === "planned"} onClick={() => setScenarioMode("planned")}>
                ✨ Planned Campaign
              </Pill>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500">Geo Maturity</div>
            <div className="flex flex-wrap gap-2">
              <Pill active={geoMaturity === "mature"} onClick={() => setGeoMaturity("mature")}>
                🌿 Mature Geo
              </Pill>
              <Pill active={geoMaturity === "new"} onClick={() => setGeoMaturity("new")}>
                🧊 New Geo
              </Pill>
            </div>
          </div>
        </div>

        {/* Existing vs Planned UI separation */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`rounded-xl border p-4 ${scenarioMode === "existing" ? "border-indigo-200 bg-indigo-50/40" : "border-gray-200 bg-white"}`}>
            <div className="flex items-center gap-2 mb-3">
              <Target size={16} className="text-indigo-600" />
              <div className="text-sm font-bold text-gray-900">Existing Campaign Setup</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-gray-600">
                Campaign
                <select
                  disabled={scenarioMode !== "existing"}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                >
                  {campaignsByBrand.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.geo ? `— ${c.geo}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold text-gray-600">
                Structure Tag (manual)
                <select
                  disabled={scenarioMode !== "existing"}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={structure}
                  onChange={(e) => setStructure(e.target.value)}
                >
                  <option value="ABO">ABO — Ad Set Budget Optimization</option>
                  <option value="CBO">CBO — Campaign Budget Optimization</option>
                  <option value="ASC">ASC — Advantage+ Sales Campaign</option>
                </select>
              </label>
            </div>

            <div className="mt-3 text-[11px] text-gray-600">
              Meta may not reliably expose your structure in your pipeline. Tagging here controls the simulator math.
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${scenarioMode === "planned" ? "border-indigo-200 bg-indigo-50/40" : "border-gray-200 bg-white"}`}>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-indigo-600" />
              <div className="text-sm font-bold text-gray-900">Planned Campaign Inputs</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-gray-600">
                Campaign Name
                <input
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  placeholder="e.g., GCC Launch - Q1"
                  value={plannedInputs.campaign_name}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, campaign_name: e.target.value })}
                />
              </label>

              <label className="text-xs font-semibold text-gray-600">
                Target Geo
                <select
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={plannedInputs.geo}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, geo: e.target.value })}
                >
                  {MockData.geos.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold text-gray-600">
                Structure Tag (planned)
                <select
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={structure}
                  onChange={(e) => setStructure(e.target.value)}
                >
                  <option value="ABO">ABO — Ad Set Budget Optimization</option>
                  <option value="CBO">CBO — Campaign Budget Optimization</option>
                  <option value="ASC">ASC — Advantage+ Sales Campaign</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-gray-600">
                Expected AOV
                <input
                  type="number"
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={plannedInputs.expectedAOV}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, expectedAOV: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <label className="text-xs font-semibold text-gray-600">
                Promo Active
                <select
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={plannedInputs.promoFlag}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, promoFlag: Number(e.target.value) })}
                >
                  <option value={0}>No</option>
                  <option value={1}>Yes</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-gray-600">
                Discount %
                <input
                  type="number"
                  disabled={scenarioMode !== "planned" || !plannedInputs.promoFlag}
                  className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={plannedInputs.discountPct}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, discountPct: Number(e.target.value) })}
                />
              </label>

              <label className="text-xs font-semibold text-gray-600">
                Active Creatives
                <input
                  type="number"
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={plannedInputs.activeCreatives}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, activeCreatives: Number(e.target.value) })}
                />
              </label>

              <label className="text-xs font-semibold text-gray-600">
                New Creatives/Wk
                <input
                  type="number"
                  disabled={scenarioMode !== "planned"}
                  className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-200 bg-white disabled:bg-gray-100"
                  value={plannedInputs.newCreativesPerWeek}
                  onChange={(e) => setPlannedInputs({ ...plannedInputs, newCreativesPerWeek: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="mt-3 text-[11px] text-gray-600">
              Planned forecasts use global priors from similar brand/geo history when available.
            </div>
          </div>
        </div>
      </SectionCard>

      {/* DATA INPUTS */}
      <SectionCard
        title="Data Inputs"
        icon={<FileUp size={16} className="text-indigo-600" />}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-xs font-bold text-blue-900 mb-2">📁 CSV Override (optional)</div>
            <input
              type="file"
              accept=".csv"
              onChange={handleCSVUpload}
              className="block w-full text-xs text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
            />
            {uploadError && <div className="mt-2 text-xs text-red-600">{uploadError}</div>}
            {csvData?.valid && (
              <div className="mt-2 flex items-center justify-between">
                <div className="text-xs text-green-700 font-semibold">✅ CSV loaded: {csvData.rows.length} rows</div>
                <button
                  type="button"
                  onClick={clearCSV}
                  className="text-[10px] font-bold text-blue-700 hover:text-blue-900"
                >
                  Clear CSV
                </button>
              </div>
            )}
            <div className="mt-2 text-[11px] text-blue-800/80">
              Use this if platform imports are down or to test alternative datasets.
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs font-bold text-gray-900 mb-2">🔌 Platform Coverage</div>
            <div className="text-[11px] text-gray-600">
              This demo assumes your backend supplies normalized daily rows.
              The simulator will auto-detect missing columns and downgrade confidence instead of crashing.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat label="Source" value={dataHealth.source} />
              <MiniStat label="Readiness" value={dataHealth.readiness} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* LOOKBACK + MODEL MODE */}
      <SectionCard
        title="Lookback + Model Mode"
        icon={<SlidersHorizontal size={16} className="text-indigo-600" />}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Lookback */}
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-gray-900">Lookback Data Window</div>
              {lookbackKey === "smart" && smartLookbackUsed !== null && (
                <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                  Auto used: ~{smartLookbackUsed}D
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {LOOKBACK_OPTIONS.map(opt => (
                <Pill
                  key={opt.key}
                  active={lookbackKey === opt.key}
                  onClick={() => setLookbackKey(opt.key)}
                  subtle
                >
                  {opt.label}
                </Pill>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-gray-600">
              {lookbackKey === "smart" && (
                <>Auto-adjusts based on data sufficiency + recent changes (typically ~14D).</>
              )}
              {lookbackKey === "full" && (
                <>May reduce responsiveness to recent changes.</>
              )}
            </div>
          </div>

          {/* Model Mode */}
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-gray-900">Model Mode</div>
              <button
                type="button"
                onClick={() => setShowModelHelp(v => !v)}
                className="text-[10px] font-semibold text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1"
              >
                <CircleHelp size={12} />
                Learn more
              </button>
            </div>

            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MODEL_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setModelKey(opt.key)}
                  className={[
                    "rounded-lg border px-3 py-2 text-left transition-all",
                    modelKey === opt.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 hover:border-gray-300"
                  ].join(" ")}
                >
                  <div className="text-xs font-bold text-gray-900">{opt.title}</div>
                  <div className="text-[10px] text-gray-600">{opt.subtitle}</div>
                </button>
              ))}
            </div>

            {showModelHelp && (
              <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-[11px] text-gray-700">
                  Auto picks a model based on your scenario, geo maturity, structure, and data health. The two
                  “Recommended” modes are explained below with real math logic in the second tab.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Auto-chosen model explanation block */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={16} className="text-indigo-600" />
            <div className="text-xs font-bold text-gray-900">Model selection outcome</div>
          </div>

          <div className="text-[11px] text-gray-600">
            Based on your configuration, the simulator recommends:
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-full">
              {MODEL_OPTIONS.find(m => m.key === effectiveModelKey)?.title || "Auto"}
            </span>
            <ConfidenceBadge level={confidenceLevel} />
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                Why this fits
              </div>
              <ul className="text-[11px] text-gray-700 space-y-1">
                {modelExplanation.whyChosen.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                Other models (educational)
              </div>
              <ul className="text-[11px] text-gray-700 space-y-1">
                {modelExplanation.others.map((o, i) => (
                  <li key={i}>
                    • <span className="font-semibold">{o.title}</span> — {o.subtitle}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* BUDGET SLIDER + INLINE RESULTS */}
      <SectionCard
        title="Budget Simulator"
        icon={<BarChart3 size={16} className="text-indigo-600" />}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: slider */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-900">
                  Daily Budget ({structure})
                </div>
                <div className="text-lg font-extrabold text-indigo-600">
                  {Number(dailyBudget).toLocaleString()} SAR/day
                </div>
              </div>

              <input
                type="range"
                min={500}
                max={20000}
                step={100}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(Number(e.target.value))}
                className="w-full mt-3 accent-indigo-600"
              />

              {/* Recommendations quick actions */}
              {recommendations && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
                      Recommended (Max ROAS)
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-sm font-extrabold text-gray-900">
                        {recommendations.maxRoas.spend.toLocaleString()} SAR/day
                      </div>
                      <button
                        type="button"
                        onClick={() => setDailyBudget(recommendations.maxRoas.spend)}
                        className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900"
                      >
                        Set slider
                      </button>
                    </div>
                    <div className="text-[11px] text-gray-700">
                      Estimated ROAS: {recommendations.maxRoas.roas.toFixed(2)}x
                    </div>
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                      Recommended (Growth Knee)
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-sm font-extrabold text-gray-900">
                        {recommendations.growthKnee.spend.toLocaleString()} SAR/day
                      </div>
                      <button
                        type="button"
                        onClick={() => setDailyBudget(recommendations.growthKnee.spend)}
                        className="text-[10px] font-bold text-blue-700 hover:text-blue-900"
                      >
                        Set slider
                      </button>
                    </div>
                    <div className="text-[11px] text-gray-700">
                      Estimated ROAS: {recommendations.growthKnee.roas.toFixed(2)}x
                    </div>
                  </div>
                </div>
              )}

              {/* Cold-start helper for planned CBO/ASC */}
              {scenarioMode === "planned" && (structure === "CBO" || structure === "ASC") && (
                <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <div className="text-[11px] font-semibold text-yellow-900">
                    Cold-start allocation
                  </div>
                  <div className="text-[11px] text-yellow-800">
                    Cold-start: equal/historical split only for Day 0. Simulator then re-allocates by predicted marginal returns.
                  </div>
                  <div className="text-[10px] text-yellow-700 mt-1">
                    Confidence: Low → improves after ~7–14 days of real data.
                  </div>
                </div>
              )}
            </div>

            {/* Inline Results directly under slider */}
            <div className="mt-4 rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
                    Projected Daily Revenue
                  </div>
                  <div className="text-3xl font-extrabold text-gray-900">
                    {Math.round(prediction.mean).toLocaleString()} SAR
                  </div>
                  <div className="text-[11px] text-gray-600">
                    Expected range: {Math.round(prediction.p10).toLocaleString()} — {Math.round(prediction.p90).toLocaleString()} SAR
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Expected ROAS
                  </div>
                  <div className="text-xl font-extrabold text-indigo-700">
                    {prediction.roas.toFixed(2)}x
                  </div>
                  <div className="mt-1">
                    <ConfidenceBadge level={confidenceLevel} />
                  </div>
                </div>
              </div>

              <div className="mt-3 text-[10px] text-gray-600 italic">
                Diminishing returns + structure-aware allocation + funnel/creative/promo context.
              </div>
            </div>
          </div>

          {/* Right: Data Health + Sanity toggle */}
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 p-4 bg-white">
              <div className="flex items-center gap-2 mb-3">
                <ListChecks size={14} className="text-indigo-600" />
                <div className="text-xs font-bold text-gray-900">Data Health</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Coverage Days" value={dataHealth.coverageDays} />
                <MiniStat label="Spend Days" value={dataHealth.activeSpendDays} />
                <MiniStat label="Readiness" value={dataHealth.readiness} />
                <MiniStat label="Confidence" value={dataHealth.confidence} tone={
                  dataHealth.confidence === "High" ? "good" :
                  dataHealth.confidence === "Medium" ? "warn" : "bad"
                } />
              </div>

              {dataHealth.missingColumns?.length > 0 && (
                <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <div className="text-[10px] font-bold text-yellow-900 uppercase tracking-wider">
                    Missing / Needed
                  </div>
                  <ul className="mt-1 text-[11px] text-yellow-800 space-y-1">
                    {dataHealth.missingColumns.map((m, i) => (
                      <li key={i}>• {m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-white">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-900">Sanity Check</div>
                <button
                  type="button"
                  onClick={() => setShowSanity(v => !v)}
                  className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1"
                >
                  {showSanity ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showSanity ? "Hide" : "Show"}
                </button>
              </div>

              <div className="mt-2 text-[11px] text-gray-600">
                Shows the exact data points and funnel context used for this run.
              </div>

              {showSanity && (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                      Curve input summary (lookback)
                    </div>
                    <div className="mt-1 text-[11px] text-gray-800">
                      Spend total: <span className="font-semibold">{Math.round(totals.spend).toLocaleString()}</span> SAR
                      {" · "}
                      Revenue total: <span className="font-semibold">{Math.round(totals.purchase_value).toLocaleString()}</span> SAR
                      {" · "}
                      Purchases: <span className="font-semibold">{Math.round(totals.purchases).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                      Funnel rates (aggregated)
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <MiniStat label="CTR" value={currentRates.ctr !== null ? (currentRates.ctr * 100).toFixed(2) + "%" : "N/A"} />
                      <MiniStat label="ATC/Click" value={currentRates.atcr !== null ? (currentRates.atcr * 100).toFixed(2) + "%" : "N/A"} />
                      <MiniStat label="IC/ATC" value={currentRates.icr !== null ? (currentRates.icr * 100).toFixed(2) + "%" : "N/A"} />
                      <MiniStat label="Purchase/IC" value={currentRates.cvr !== null ? (currentRates.cvr * 100).toFixed(2) + "%" : "N/A"} />
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                      Adjustments applied
                    </div>
                    <div className="mt-1 text-[11px] text-gray-800">
                      Quality: <span className="font-semibold">{qualityAdj.toFixed(2)}</span>
                      {" · "}
                      Creative: <span className="font-semibold">{creativeAdj.toFixed(2)}</span>
                      {" · "}
                      Promo: <span className="font-semibold">{promoAdj.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-white border border-gray-200 p-3">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Rows used (last 12 shown)
                    </div>
                    <div className="space-y-1">
                      {(lookbackRows || []).slice(-12).map((r, i) => (
                        <div key={i} className="text-[10px] text-gray-700 flex justify-between border-b border-gray-100 py-1">
                          <span>{r.date}</span>
                          <span className="font-semibold">{Math.round(Number(r.spend || 0)).toLocaleString()} spend</span>
                          <span>{Math.round(Number(r.purchase_value || 0)).toLocaleString()} rev</span>
                        </div>
                      ))}
                      {(lookbackRows || []).length === 0 && (
                        <div className="text-[10px] text-gray-500">No rows available.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ============================================================================
   MATH FLOW TAB (Educational)
   ============================================================================ */

function AIBudgetMathFlowTab({ platformRows }) {
  const [structure, setStructure] = useState("CBO");
  const [mode, setMode] = useState("existing");
  const [lookbackKey, setLookbackKey] = useState("smart");
  const [demoBudget, setDemoBudget] = useState(5000);

  const [brand, setBrand] = useState("Virona");
  const [geo, setGeo] = useState("SA");

  const allRows = useMemo(() => {
    if (platformRows && platformRows.length) return platformRows;
    return MockData.generateAllRows(30);
  }, [platformRows]);

  const filtered = useMemo(() => {
    return (allRows || []).filter(r =>
      (!brand || (r.brand || "").toLowerCase() === brand.toLowerCase()) &&
      (!geo || (r.geo || "") === geo)
    );
  }, [allRows, brand, geo]);

  const lookbackRows = useMemo(() => applyLookback(filtered, lookbackKey), [filtered, lookbackKey]);

  const params = useMemo(() => {
    if (mode === "planned") {
      const priors = MathUtils.computeGlobalPriors(allRows, geo, brand);
      return { alpha: priors.alpha_prior, k: priors.k_prior, gamma: priors.gamma_prior, lambda: 0.5 };
    }
    return MathUtils.estimateParameters(lookbackRows);
  }, [mode, allRows, lookbackRows, geo, brand]);

  const totals = useMemo(() => aggregateTotals(lookbackRows), [lookbackRows]);
  const currentRates = useMemo(() => MathUtils.computeFunnelRatesAgg(totals), [totals]);
  const histStats = useMemo(() => computeHistoricalFunnelStats(lookbackRows), [lookbackRows]);

  const qualityAdj = useMemo(() => MathUtils.computeQualityAdjustment(currentRates, histStats), [currentRates, histStats]);
  const creativeAdj = useMemo(() => MathUtils.computeCreativeAdjustment(3, demoBudget), [demoBudget]);
  const promoAdj = useMemo(() => 1.0, []);

  const adjustments = useMemo(() => ({ qualityAdj, creativeAdj, promoAdj }), [qualityAdj, creativeAdj, promoAdj]);

  const mean = useMemo(() => MathUtils.predictRevenue(demoBudget, params, adjustments), [demoBudget, params, adjustments]);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Budget Math Flow"
        icon={<LineChart size={16} className="text-indigo-600" />}
      >
        <div className="text-[11px] text-gray-600 mb-4">
          This tab is an educational map of the simulator logic. It is intentionally simplified visually so non-technical users
          can understand what drives the final numbers.
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <label className="text-xs font-semibold text-gray-600">
            Brand
            <select
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            >
              {MockData.brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>

          <label className="text-xs font-semibold text-gray-600">
            Geo
            <select
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200"
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
            >
              {MockData.geos.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>

          <label className="text-xs font-semibold text-gray-600">
            Scenario
            <select
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="existing">Existing</option>
              <option value="planned">Planned</option>
            </select>
          </label>

          <label className="text-xs font-semibold text-gray-600">
            Structure
            <select
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200"
              value={structure}
              onChange={(e) => setStructure(e.target.value)}
            >
              <option value="ABO">ABO</option>
              <option value="CBO">CBO</option>
              <option value="ASC">ASC</option>
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-gray-900">Lookback selector</div>
            {lookbackKey === "smart" && (
              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                Auto used: ~{chooseSmartLookback(filtered)}D
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {LOOKBACK_OPTIONS.map(opt => (
              <Pill
                key={opt.key}
                active={lookbackKey === opt.key}
                onClick={() => setLookbackKey(opt.key)}
                subtle
              >
                {opt.label}
              </Pill>
            ))}
          </div>
          {lookbackKey === "full" && (
            <div className="mt-2 text-[11px] text-gray-600">May reduce responsiveness to recent changes.</div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-xs font-bold text-gray-900 mb-2">1) Curve foundation</div>
            <div className="text-[11px] text-gray-700">
              We estimate a diminishing returns curve using adstocked spend and a Hill saturation function.
              In planned mode, we use priors from similar brand/geo history.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat label="alpha" value={Math.round(params.alpha).toLocaleString()} />
              <MiniStat label="k" value={Math.round(params.k).toLocaleString()} />
              <MiniStat label="gamma" value={params.gamma.toFixed(2)} />
              <MiniStat label="lambda" value={(params.lambda ?? 0.5).toFixed(2)} />
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-xs font-bold text-gray-900 mb-2">2) Context multipliers</div>
            <div className="text-[11px] text-gray-700">
              We adjust the base curve using funnel quality, creative sufficiency, and promo context.
              Missing inputs simply default to neutral multipliers.
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniStat label="Quality Adj" value={qualityAdj.toFixed(2)} />
              <MiniStat label="Creative Adj" value={creativeAdj.toFixed(2)} />
              <MiniStat label="Promo Adj" value={promoAdj.toFixed(2)} />
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-indigo-700" />
            <div className="text-xs font-bold text-indigo-900">3) Budget probe</div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-indigo-900">Demo daily budget</div>
              <div className="text-lg font-extrabold text-indigo-700">
                {demoBudget.toLocaleString()} SAR
              </div>
            </div>
            <input
              type="range"
              min={500}
              max={20000}
              step={100}
              value={demoBudget}
              onChange={(e) => setDemoBudget(Number(e.target.value))}
              className="w-full mt-2 accent-indigo-600"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white border border-indigo-200 p-3">
              <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Base prediction</div>
              <div className="text-xl font-extrabold text-gray-900">
                {Math.round(mean).toLocaleString()} SAR/day
              </div>
              <div className="text-[11px] text-gray-600">
                This is the curve × multipliers output before structure allocation detail.
              </div>
            </div>
            <div className="rounded-lg bg-white border border-indigo-200 p-3">
              <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Structure note</div>
              <div className="text-[11px] text-gray-700">
                <span className="font-semibold">{structure}</span> determines how this budget is interpreted:
                ABO treats this as an ad set-level direct control; CBO/ASC treat it as a campaign pool that is split using
                historical and predicted marginal returns.
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ============================================================================
   MAIN APP
   ============================================================================ */

export default function AIBudgetApp() {
  const [activeTab, setActiveTab] = useState("sim"); // sim | flow

  // In real app:
  // Replace this with data from your platform state/store.
  // Example:
  // const platformRows = useMemo(() => dashboard?.meta_daily_rows ?? [], [dashboard]);
  const platformRows = null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-50">
              <Brain size={22} className="text-indigo-600" />
            </span>
            <div>
              <div className="text-2xl font-extrabold text-gray-900 leading-tight">
                AI Budget Simulator
              </div>
              <div className="text-sm text-gray-500">
                Structure-aware, data-safe what-if forecasting for Virona/Shawq-style multi-geo scaling
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 flex flex-wrap gap-2">
            <Pill active={activeTab === "sim"} onClick={() => setActiveTab("sim")}>
              📊 Simulator
            </Pill>
            <Pill active={activeTab === "flow"} onClick={() => setActiveTab("flow")}>
              🧠 Math Flow
            </Pill>
          </div>
        </div>

        {/* Content */}
        {activeTab === "sim" ? (
          <AIBudgetSimulatorTab platformRows={platformRows} />
        ) : (
          <AIBudgetMathFlowTab platformRows={platformRows} />
        )}

        {/* Footer notes */}
        <div className="text-[10px] text-gray-400 text-center py-4">
          Frontend-only demo logic. For production accuracy, fit per-adset curves server-side and feed recent spend shares.
        </div>
      </div>
    </div>
  );
}
