/**
 * AIBudgetSingleFile.jsx (vNext - Spec Locked)
 * Frontend-only React 18 component (single file).
 *
 * Allowed imports: React hooks + lucide-react icons only.
 * Styling: Tailwind CSS.
 *
 * Purpose
 * - Structure-aware budget simulator for Virona/Shawq-style multi-geo scaling.
 * - Supports Existing vs Planned campaigns.
 * - Supports structures: ABO (Ad Set Budget Optimization), CBO (Campaign Budget Optimization), ASC (Advantage+ Sales Campaign).
 *
 * Core UI/Math commitments implemented here:
 * 1) Model Strategy (family) + Model Execution Mode (engine variant).
 *    - You choose Strategy.
 *    - Mode auto-selects based on Strategy + structure + data sufficiency.
 *    - UI shows why chosen + when other modes are better.
 *
 * 2) Lookback control:
 *    🧠 Smart (recommended) | 14D | 30D | 90D | Full History
 *    - Smart resolves to X days; UI shows the resolved value.
 *    - Full History warning about reduced responsiveness.
 *
 * 3) Results are under the budget slider to preserve “budget-first” mental model.
 *
 * 4) Must-fix correctness:
 *    - CBO/ASC thin allocation layer:
 *        Budget → inferred ad set split → summed outcome.
 *    - Revenue-field normalization + confidence wiring.
 *
 * 5) Data Health labeling:
 *    - All-Time Coverage Days
 *    - Lookback Rows Used
 *
 * 6) Scoped data add-ons:
 *    - Upload multiple CSV files next to the configuration.
 *    - Two behaviors:
 *        a) CSV Override (replaces platform rows for this configuration scope)
 *        b) CSV Complement (fills missing columns/days for this scope)
 *
 * 7) Reference Campaigns:
 *    - Existing: optional priors boosters.
 *    - Planned: optional anchor or required for New/Thin geos in real backend.
 *
 * NOTE
 * This is a demo-ready frontend shell with deterministic math + clear wiring.
 * Hooks into backend budget intelligence data.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Brain,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  HelpCircle,
  Info,
  Layers,
  LineChart,
  SlidersHorizontal,
  Target,
  Upload,
  Wand2,
  XCircle
} from "lucide-react";
import { useMetaObjects } from "../features/meta-awareness/hooks/useMetaStatus.js";

// Normalize a single row from /api/budget-intelligence into the metric
// names the simulator expects.
function normalizeIntelRow(row) {
  if (!row) return row;

  const out = { ...row };

  // Core identifiers
  out.campaign_id =
    row.campaign_id ||
    row.campaignId ||
    row.campaign_id_raw ||
    null;

  out.campaign_name =
    row.campaign_name ||
    row.campaignName ||
    row.campaign ||
    null;

  // Geo
  out.geo =
    row.geo ||
    row.country ||
    row.country_code ||
    null;

  // Date (daily bucket)
  out.date =
    row.date ||
    row.day ||
    row.date_start ||
    row.reporting_starts ||
    null;

  // Spend
  out.spend =
    row.spend ||
    row.totalSpend ||
    row.total_spend ||
    row.amount_spent ||
    null;

  // Revenue / purchase value
  out.purchase_value =
    row.purchase_value ||
    row.revenue ||
    row.totalRevenue ||
    row.conversion_value ||
    null;

  // Conversions / orders
  out.purchases =
    row.purchases ||
    row.orders ||
    row.total_orders ||
    row.conversions ||
    null;

  // Funnel metrics (optional but very useful)
  out.impressions =
    row.impressions ||
    row.impressions_raw ||
    null;

  out.clicks =
    row.clicks ||
    row.link_clicks ||
    null;

  out.atc =
    row.atc ||
    row.add_to_cart ||
    row.adds_to_cart ||
    null;

  out.ic =
    row.ic ||
    row.checkouts_initiated ||
    row.initiated_checkouts ||
    null;

  return out;
}

/* ============================================================================
   MATH UTILITIES (Elite-lite, deterministic, safe)
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
  median(arr) {
    if (!arr || arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  },
  percentile(arr, p) {
    if (!arr || arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const idx = MathUtils.clamp(0, s.length - 1, Math.floor((p / 100) * (s.length - 1)));
    return s[idx];
  },

  /* ----------------------------
     Revenue normalization
     ---------------------------- */
  normalizeRevenueRow(row, manualAov = null) {
    // Priority:
    // 1) purchase_value
    // 2) purchases * manualAov
    // 3) purchases * inferredAov (fallback)
    if (Number.isFinite(row?.purchase_value) && row.purchase_value > 0) {
      return { value: row.purchase_value, source: "purchase_value" };
    }
    if (Number.isFinite(row?.purchases) && row.purchases > 0) {
      const aov = Number.isFinite(manualAov) && manualAov > 0 ? manualAov : 150;
      return { value: row.purchases * aov, source: manualAov ? "manual_aov" : "fallback_aov" };
    }
    return { value: 0, source: "none" };
  },

  /* ----------------------------
     Adstock + Hill saturation
     ---------------------------- */
  computeAdstock(spendArray, lambda = 0.5) {
    let prev = 0;
    const out = [];
    for (let i = 0; i < spendArray.length; i++) {
      const cur = (spendArray[i] || 0) + lambda * prev;
      out.push(cur);
      prev = cur;
    }
    return out;
  },

  hill(adstock, alpha, k, gamma = 1) {
    if (!Number.isFinite(adstock) || adstock <= 0) return 0;
    const num = Math.pow(adstock, gamma);
    const den = Math.pow(k, gamma) + num;
    return alpha * MathUtils.safeDivide(num, den, 0);
  },

  /* ----------------------------
     Parameter estimation (heuristic but corrected)
     - Fixes alpha inversion issue from audit.
     - Uses median adstock as k prior proxy.
     ---------------------------- */
  estimateHillParams(rows, lambda = 0.5) {
    const clean = rows.filter(r => Number.isFinite(r.spend) && r.spend > 0);
    if (clean.length < 5) {
      return { alpha: 6000, k: 2000, gamma: 1.0, lambda };
    }
    const spends = clean.map(r => r.spend);
    const ad = MathUtils.computeAdstock(spends, lambda);
    const k = Math.max(100, MathUtils.median(ad) || 1000);

    // Use normalized revenue if present in row pre-processing
    const revs = clean.map(r => Number.isFinite(r._normRevenue) ? r._normRevenue : (r.purchase_value || 0));
    const meanRev = revs.reduce((a, b) => a + b, 0) / Math.max(1, revs.length);
    const meanAd = ad.reduce((a, b) => a + b, 0) / Math.max(1, ad.length);

    // Correct inversion for gamma=1:
    // revenue = alpha * (X / (k + X))  => alpha = revenue * (k + X) / X
    const alpha = Math.max(
      100,
      meanAd > 0 ? meanRev * (k + meanAd) / meanAd : meanRev * 2
    );

    return { alpha, k, gamma: 1.0, lambda };
  },

  /* ----------------------------
     Creative sufficiency adjustment (smooth)
     - Fixes step-discontinuity issue.
     ---------------------------- */
  creativeAdj(activeCreatives, dailySpend) {
    const k = Math.max(1, Number(activeCreatives) || 1);
    const s = Math.max(0, Number(dailySpend) || 0);
    const csr = k / Math.max(1, s / 1000); // creatives per ~1k/day
    const raw = 0.7 + 0.3 * MathUtils.clamp(0, 1, csr);
    return MathUtils.clamp(0.7, 1.0, raw);
  },

  /* ----------------------------
     Promo adjustment (non-linear conservative)
     ---------------------------- */
  promoAdj(promoFlag, discountPct) {
    if (!promoFlag) return 1.0;
    const d = MathUtils.clamp(0, 60, Number(discountPct) || 0);
    // mild convex lift: small discounts get slightly more than linear
    const lift = 1 + 0.012 * d + 0.00012 * d * d;
    return MathUtils.clamp(1.0, 1.35, lift);
  },

  /* ----------------------------
     Quality adjustment from funnel rates (stable)
     ---------------------------- */
  funnelRates(row) {
    return {
      ctr: MathUtils.safeDivide(row.clicks, row.impressions, null),
      atcr: MathUtils.safeDivide(row.atc, row.clicks, null),
      icr: MathUtils.safeDivide(row.ic, row.atc, null),
      cvr: MathUtils.safeDivide(row.purchases, row.ic, null)
    };
  },

  computeQualityAdj(currentRates, historicalBench) {
    if (!currentRates || !historicalBench) return 1.0;
    const weights = { ctr: 0.4, atcr: 0.2, icr: 0.2, cvr: 0.2 };
    let Q = 0;
    let used = 0;

    Object.keys(weights).forEach(k => {
      const cur = currentRates[k];
      const bench = historicalBench[k];
      if (cur !== null && cur !== undefined && bench) {
        const med = bench.median ?? bench.mean ?? 0;
        const iqr = Math.max(bench.iqr ?? 0.01, 0.005);
        const z = (cur - med) / iqr;
        Q += weights[k] * MathUtils.clamp(-2.5, 2.5, z);
        used++;
      }
    });

    if (!used) return 1.0;
    return MathUtils.clamp(0.8, 1.25, 1 + 0.12 * Q);
  },

  buildHistoricalBench(rows) {
    const keys = ["ctr", "atcr", "icr", "cvr"];
    const buckets = { ctr: [], atcr: [], icr: [], cvr: [] };
    rows.forEach(r => {
      const fr = MathUtils.funnelRates(r);
      keys.forEach(k => {
        if (Number.isFinite(fr[k]) && fr[k] > 0) buckets[k].push(fr[k]);
      });
    });
    const bench = {};
    keys.forEach(k => {
      const arr = buckets[k];
      bench[k] = {
        median: MathUtils.median(arr) ?? 0,
        iqr: (MathUtils.percentile(arr, 75) ?? 0) - (MathUtils.percentile(arr, 25) ?? 0)
      };
    });
    return bench;
  },

  /* ----------------------------
     Budget allocation layer
     ---------------------------- */
  inferAdsetShares(lookbackRows) {
    // Use ad set level spend shares within lookback.
    const adRows = lookbackRows.filter(r => r.adset_id && Number.isFinite(r.spend));
    const map = new Map();
    adRows.forEach(r => {
      const cur = map.get(r.adset_id) || { id: r.adset_id, name: r.adset_name, spend: 0 };
      cur.spend += r.spend;
      map.set(r.adset_id, cur);
    });
    const arr = Array.from(map.values());
    const total = arr.reduce((a, b) => a + b.spend, 0);
    if (!arr.length || total <= 0) return [];
    return arr.map(a => ({
      id: a.id,
      name: a.name,
      share: MathUtils.safeDivide(a.spend, total, 0)
    }));
  },

  allocateBudgetThin({ structure, dailyBudget, adsets, lookbackRows }) {
    // Returns [{id,name,budget,shareSource}]
    const k = Math.max(1, adsets.length);
    if (structure === "ABO") {
      // Treat slider as a total envelope; distribute evenly for simplicity.
      const each = dailyBudget / k;
      return adsets.map(a => ({ ...a, budget: each, shareSource: "equal_abO_envelope" }));
    }

    // CBO/ASC
    const shares = MathUtils.inferAdsetShares(lookbackRows);
    if (shares.length === adsets.length) {
      return adsets.map(a => {
        const s = shares.find(x => x.id === a.id)?.share ?? (1 / k);
        return { ...a, budget: dailyBudget * s, shareSource: "historical" };
      });
    }

    // Fallback equal split (cold start)
    const each = dailyBudget / k;
    return adsets.map(a => ({ ...a, budget: each, shareSource: "equal_fallback" }));
  },

  /* ----------------------------
     Predict daily revenue given parameters + adjustments
     ---------------------------- */
  predictFromParams(spend, params, adj = {}) {
    const base = MathUtils.hill(spend, params.alpha, params.k, params.gamma);
    const q = adj.qualityAdj ?? 1;
    const c = adj.creativeAdj ?? 1;
    const p = adj.promoAdj ?? 1;
    return base * q * c * p;
  },

  /* ----------------------------
     Compute recommended budgets
     - Max ROAS: best efficiency per riyal.
     - Growth Knee: best balance of scale + efficiency (simple elbow heuristic).
     ---------------------------- */
  scanBudgetGrid({ min, max, step, params, adj }) {
    const grid = [];
    for (let s = min; s <= max; s += step) {
      const rev = MathUtils.predictFromParams(s, params, adj);
      const roas = MathUtils.safeDivide(rev, s, 0);
      grid.push({ spend: s, revenue: rev, roas });
    }
    return grid;
  },

  findMaxRoas(grid) {
    if (!grid.length) return null;
    let best = grid[0];
    grid.forEach(g => {
      if (g.roas > best.roas) best = g;
    });
    return best;
  },

  findGrowthKnee(grid) {
    // Simple robust heuristic:
    // pick the first point where marginal ROAS drops below 70% of Max ROAS
    // after passing a minimum spend floor.
    if (!grid.length) return null;
    const best = MathUtils.findMaxRoas(grid);
    if (!best) return null;
    const bestRoas = best.roas;
    for (let i = 1; i < grid.length; i++) {
      const prev = grid[i - 1];
      const cur = grid[i];
      const dRev = cur.revenue - prev.revenue;
      const dSpend = cur.spend - prev.spend;
      const mRoas = MathUtils.safeDivide(dRev, dSpend, 0);
      if (cur.spend >= best.spend && mRoas > 0 && mRoas <= bestRoas * 0.7) {
        return cur;
      }
    }
    // fallback to ~2x best spend cap if no knee detected
    const target = best.spend * 2;
    let closest = grid[grid.length - 1];
    grid.forEach(g => {
      if (Math.abs(g.spend - target) < Math.abs(closest.spend - target)) closest = g;
    });
    return closest;
  }
};

/* ============================================================================
   DATA VALIDATION + MERGE (multi-file)
   ============================================================================ */

const DataValidator = {
  REQUIRED: ["date", "geo", "spend"],
  RECOMMENDED: ["purchase_value", "purchases", "impressions", "clicks", "atc", "ic", "adset_id", "adset_name"],
  OPTIONAL: ["campaign_id", "campaign_name", "brand", "structure", "frequency", "active_creatives_count", "new_creatives_7d", "promo_flag", "discount_pct"],

  parseCSVText(text) {
    const lines = String(text).split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { rows: [], headers: [] };
    const headers = lines[0].split(",").map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] !== undefined ? vals[i].trim() : "";
      });
      return obj;
    });
    return { rows, headers };
  },

  coerceRow(row) {
    const numFields = ["spend", "purchase_value", "purchases", "impressions", "clicks", "atc", "ic", "frequency", "active_creatives_count", "new_creatives_7d", "discount_pct"];
    const out = { ...row };
    numFields.forEach(f => {
      if (out[f] === "" || out[f] === undefined) return;
      const v = Number(out[f]);
      out[f] = Number.isFinite(v) ? v : out[f];
    });
    out.promo_flag = out.promo_flag === "1" || out.promo_flag === 1 ? 1 : 0;
    return out;
  },

  validate(rows) {
    if (!rows || rows.length === 0) return { ok: false, error: "CSV is empty." };
    const headers = Object.keys(rows[0] || {});
    const missing = DataValidator.REQUIRED.filter(r => !headers.includes(r));
    if (missing.length) return { ok: false, error: `Missing required columns: ${missing.join(", ")}` };
    return { ok: true };
  },

  mergeComplement(baseRows, complementRows) {
    // Merge by date + campaign_name + adset_id + geo when present.
    const keyOf = (r) => [
      r.date,
      r.campaign_name || r.campaign_id || "unknown_campaign",
      r.adset_id || "no_adset",
      r.geo || "unknown_geo"
    ].join("||");

    const map = new Map();
    baseRows.forEach(r => map.set(keyOf(r), { ...r }));

    complementRows.forEach(r => {
      const k = keyOf(r);
      if (!map.has(k)) {
        map.set(k, { ...r });
      } else {
        const cur = map.get(k);
        const merged = { ...cur };
        Object.keys(r).forEach(field => {
          if (merged[field] === null || merged[field] === undefined || merged[field] === "" ) {
            merged[field] = r[field];
          }
        });
        map.set(k, merged);
      }
    });

    return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
};

/* ============================================================================
   MODEL STRATEGIES (family) + EXECUTION MODES (engine)
   ============================================================================ */

const STRATEGY_FAMILIES = [
  {
    key: "structure_aware",
    title: "🧠 Structure-Aware Diminishing Returns",
    bestFor: "Existing CBO/ASC (and most mature campaigns).",
    blurb:
      "Fits diminishing returns and adds structure realism via ad set allocation when Meta controls distribution."
  },
  {
    key: "abo_direct",
    title: "🎛️ Ad Set Direct Curve (ABO)",
    bestFor: "ABO setups where budgets are controlled per ad set.",
    blurb:
      "Treats the slider as an envelope across ad sets and forecasts using direct curves without needing allocation inference."
  },
  {
    key: "bayes_transfer",
    title: "🧬 New Market Launch Support",
    bestFor: "New/Thin geos; imports learning from mature anchors you choose.",
    blurb:
      "Uses your selected reference campaigns to build conservative priors for a cold-start launch."
  },
  {
    key: "geo_pooling",
    title: "🌍 Multi-Country Intelligence",
    bestFor: "Multi-geo scaling with shared learning.",
    blurb:
      "Builds shared priors across your countries and calibrates each geo’s curve using pooled evidence."
  },
  {
    key: "mmm_lite",
    title: "🧩 Long-Horizon Planning",
    bestFor: "Medium/long planning horizons (not day-to-day sliders).",
    blurb:
      "Uses longer lookbacks and conservative curve shapes for budget planning across periods."
  }
];

const EXECUTION_MODES = [
  {
    key: "curve_only",
    friendly: "📈 Simple Response Curve",
    advanced: "Curve Only",
    when: "ABO or when you only trust the response curve that day."
  },
  {
    key: "curve_allocation",
    friendly: "🧠 Structure Realism",
    advanced: "Curve + Allocation",
    when: "CBO/ASC with adequate ad set history."
  },
  {
    key: "curve_priors",
    friendly: "🌍 Cold-Start Support",
    advanced: "Curve + Priors",
    when: "New campaigns/geos anchored by reference campaigns."
  },
  {
    key: "hybrid",
    friendly: "🧠🌍 Best Available Blend",
    advanced: "Hybrid (Allocation + Priors)",
    when: "Thin data + CBO/ASC; most realistic default when uncertain."
  },
  {
    key: "incrementality",
    friendly: "🧪 Causal-Adjusted",
    advanced: "Incrementality-Calibrated",
    when: "When you have incrementality test inputs (future backend)."
  }
];

/* ============================================================================
   LOOKBACK
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
  // Conservative adaptive heuristic.
  if (days >= 120) return 30;
  if (days >= 60) return 30;
  if (days >= 30) return 14;
  if (days >= 14) return 14;
  if (days >= 7) return 7;
  return Math.max(0, days);
}

function applyLookback(rows, key) {
  if (!rows || rows.length === 0) return [];
  if (key === "full") return rows;
  if (key === "smart") {
    const lb = chooseSmartLookback(rows);
    return lb ? rows.slice(-lb) : rows;
  }
  const n = Number(key);
  if (!Number.isFinite(n) || n <= 0) return rows;
  return rows.slice(-n);
}

/* ============================================================================
   DATA HEALTH + SUFFICIENCY ADVISOR
   ============================================================================ */

function computeDataHealth({ allRows, lookbackRows, structure, scenarioType }) {
  const allTimeDays = new Set((allRows || []).map(r => r.date)).size;
  const lookbackUsed = lookbackRows?.length || 0;
  const spendDays = (lookbackRows || []).filter(r => !r.adset_id && r.spend > 0).length;

  const hasSpend = (lookbackRows || []).some(r => Number.isFinite(r.spend) && r.spend > 0);
  const hasRevenue = (lookbackRows || []).some(r => Number.isFinite(r._normRevenue) && r._normRevenue > 0);

  const hasFunnel = (lookbackRows || []).some(r =>
    Number.isFinite(r.impressions) &&
    Number.isFinite(r.clicks) &&
    Number.isFinite(r.atc) &&
    Number.isFinite(r.ic)
  );

  const hasAdsetSpend = (lookbackRows || []).some(r => r.adset_id && Number.isFinite(r.spend));

  let status = "🚫 Not Enough";
  let confidence = "Low";
  const missing = [];

  if (!hasSpend) missing.push("Spend");
  if (!hasRevenue) missing.push("Revenue (purchase_value or purchases + AOV)");

  if (!hasFunnel) missing.push("Funnel metrics (impressions, clicks, ATC, IC)");

  if ((structure === "CBO" || structure === "ASC") && !hasAdsetSpend) {
    missing.push("Ad set-level spend history (for CBO/ASC allocation realism)");
  }

  if (hasSpend && hasRevenue) {
    if (scenarioType === "planned") {
      status = "🟡 Enough for Partial Model";
      confidence = !missing.length ? "Medium" : "Low";
    } else {
      // existing
      if (lookbackUsed >= 14 && spendDays >= 10) {
        status = "✅ Enough for Full Model";
        confidence = hasFunnel && (structure === "ABO" || hasAdsetSpend) ? "High" : "Medium";
      } else if (lookbackUsed >= 7 && spendDays >= 5) {
        status = "🟡 Enough for Partial Model";
        confidence = "Medium";
        missing.push(`Add ${Math.max(0, 14 - lookbackUsed)} more lookback days for full curve stability`);
      } else {
        status = "🚫 Not Enough";
        confidence = "Low";
        missing.push("Need at least 7 days with spend + revenue");
      }
    }
  }

  return {
    allTimeDays,
    lookbackUsed,
    spendDays,
    hasFunnel,
    hasAdsetSpend,
    status,
    confidence,
    missing
  };
}

/* ============================================================================
   SCOPED DATA RESOLUTION (Platform + Files + Manual)
   ============================================================================ */

function scopeFilterRows(rows, { campaignName, geo, includeAdsets = true }) {
  let out = rows || [];
  if (campaignName) out = out.filter(r => r.campaign_name === campaignName);
  if (geo) out = out.filter(r => r.geo === geo);
  if (!includeAdsets) out = out.filter(r => !r.adset_id);
  return out;
}

/* ============================================================================
   UI ATOMS
   ============================================================================ */

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full text-xs font-semibold border transition",
        active
          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
          : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:text-indigo-700"
      ].join(" ")}
      type="button"
    >
      {children}
    </button>
  );
}

function SectionCard({ title, subtitle, icon, children, right }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5">{icon}</span>
          <div>
            <div className="text-sm font-extrabold text-gray-900">{title}</div>
            {subtitle ? (
              <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>
            ) : null}
          </div>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ============================================================================
   MULTI-FILE UPLOAD (scoped)
   ============================================================================ */

function MultiFileUpload({
  label,
  onFilesParsed,
  overrideMode,
  setOverrideMode,
  summary
}) {
  const inputRef = useRef(null);

  const handleFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;

    const parsed = [];
    for (const f of list) {
      const text = await f.text();
      const { rows } = DataValidator.parseCSVText(text);
      const coerced = rows.map(DataValidator.coerceRow);
      const v = DataValidator.validate(coerced);
      if (!v.ok) {
        parsed.push({ file: f.name, ok: false, error: v.error, rows: [] });
      } else {
        parsed.push({ file: f.name, ok: true, error: "", rows: coerced });
      }
    }

    onFilesParsed(parsed);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="rounded-xl border border-gray-200 p-3 bg-gray-50">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-gray-900 flex items-center gap-1">
          <Upload size={12} className="text-indigo-600" />
          {label}
        </div>
        <div className="flex items-center gap-1">
          <Pill
            active={overrideMode === "override"}
            onClick={() => setOverrideMode("override")}
          >
            Override
          </Pill>
          <Pill
            active={overrideMode === "complement"}
            onClick={() => setOverrideMode("complement")}
          >
            Complement
          </Pill>
        </div>
      </div>

      <div className="mt-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="block w-full text-[11px] text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer"
        />
      </div>

      {summary ? (
        <div className="mt-2 text-[10px] text-gray-600">
          {summary}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
   STRATEGY + MODE ADVISOR UI
   ============================================================================ */

function StrategySelector({ value, onChange }) {
  return (
    <div className="space-y-2">
      {STRATEGY_FAMILIES.map(f => (
        <button
          key={f.key}
          type="button"
          onClick={() => onChange(f.key)}
          className={[
            "w-full text-left rounded-xl border p-3 transition",
            value === f.key
              ? "border-indigo-200 bg-indigo-50"
              : "border-gray-200 hover:border-indigo-200"
          ].join(" ")}
        >
          <div className="text-xs font-extrabold text-gray-900">{f.title}</div>
          <div className="text-[11px] text-gray-600 mt-0.5">{f.bestFor}</div>
          <div className="text-[11px] text-gray-500 mt-1">{f.blurb}</div>
        </button>
      ))}
    </div>
  );
}

function ModeExplainRow({ modeKey, active }) {
  const m = EXECUTION_MODES.find(x => x.key === modeKey);
  if (!m) return null;
  return (
    <div
      className={[
        "rounded-lg border px-3 py-2",
        active ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-white"
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-gray-900">
          {m.friendly}
          <span className="text-[10px] text-gray-500 font-semibold ml-1">
            — {m.advanced}
          </span>
        </div>
        {active ? (
          <span className="text-[10px] font-bold text-indigo-700">Selected</span>
        ) : null}
      </div>
      <div className="text-[10px] text-gray-600 mt-0.5">{m.when}</div>
    </div>
  );
}

/* ============================================================================
   MAIN SIMULATOR TAB
   ============================================================================ */

function AIBudgetSimulatorTab({ store }) {
  const currentStore = store || "vironax";
  const [scenarioType, setScenarioType] = useState("existing"); // existing | planned

  const [intel, setIntel] = useState(null);
  const [loadingIntel, setLoadingIntel] = useState(true);
  const [intelError, setIntelError] = useState(null);

  useEffect(() => {
    async function loadIntel() {
      try {
        setLoadingIntel(true);
        const res = await fetch(`/api/budget-intelligence?store=${currentStore}`);
        const data = await res.json();
        setIntel(data);
        setIntelError(null);
      } catch (e) {
        setIntelError("Failed to load budget intelligence");
      } finally {
        setLoadingIntel(false);
      }
    }

    loadIntel();
  }, [currentStore]);

  // Meta campaigns
  const { objects: metaObjects } = useMetaObjects(store, { autoFetch: !!store });
  const metaCampaignNames = useMemo(() => {
    const payload = metaObjects?.data || metaObjects;
    const campaigns = payload?.campaigns || [];
    const names = campaigns
      .map(c => c.object_name || c.campaign_name || c.name)
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [metaObjects]);

  // Existing configuration
  const [existingCampaign, setExistingCampaign] = useState("");
  const [existingGeo, setExistingGeo] = useState("SA");
  const [existingStructure, setExistingStructure] = useState("CBO");
  const [existingGeoMaturity, setExistingGeoMaturity] = useState("mature"); // mature | thin

  // Planned configuration
  const [plannedSource, setPlannedSource] = useState("new"); // new | meta_template
  const [plannedTemplateCampaign, setPlannedTemplateCampaign] = useState("");
  const [plannedGeo, setPlannedGeo] = useState("SA");
  const [plannedStructure, setPlannedStructure] = useState("CBO");
  const [plannedGeoMaturity, setPlannedGeoMaturity] = useState("thin");

  const [expectedAov, setExpectedAov] = useState(150);
  const [promoFlag, setPromoFlag] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [activeCreatives, setActiveCreatives] = useState(3);

  // Reference campaigns (manual priors control)
  const [refCampaignsExisting, setRefCampaignsExisting] = useState([]);
  const [refCampaignsPlanned, setRefCampaignsPlanned] = useState([]);

  // Lookback
  const [lookbackKey, setLookbackKey] = useState("smart");
  const [resolvedSmartDays, setResolvedSmartDays] = useState(null);

  // Files per scope (multi-file parsed results)
  const [existingFilePackets, setExistingFilePackets] = useState([]);
  const [plannedFilePackets, setPlannedFilePackets] = useState([]);
  const [existingFileMode, setExistingFileMode] = useState("complement");
  const [plannedFileMode, setPlannedFileMode] = useState("complement");

  // Strategy + Mode
  const [strategyKey, setStrategyKey] = useState("structure_aware");
  const [modeKeyManual, setModeKeyManual] = useState("auto"); // keep for future; UI is auto-only
  const [autoModeKey, setAutoModeKey] = useState("hybrid");
  const [autoModeWhy, setAutoModeWhy] = useState([]);

  // Budget
  const [dailyBudget, setDailyBudget] = useState(3500);
  const [sliderBounds, setSliderBounds] = useState({ min: 500, max: 12000, step: 100 });

  /* ----------------------------
     Resolve the active configuration
     ---------------------------- */
  const activeConfig = useMemo(() => {
    if (scenarioType === "existing") {
      return {
        scenarioType,
        campaignName: existingCampaign,
        geo: existingGeo,
        structure: existingStructure,
        geoMaturity: existingGeoMaturity,
        planned: false,
        plannedSource: null
      };
    }
    return {
      scenarioType,
      campaignName:
        plannedSource === "meta_template" ? plannedTemplateCampaign : null,
      geo: plannedGeo,
      structure: plannedStructure,
      geoMaturity: plannedGeoMaturity,
      planned: true,
      plannedSource
    };
  }, [
    scenarioType,
    existingCampaign,
    existingGeo,
    existingStructure,
    existingGeoMaturity,
    plannedSource,
    plannedTemplateCampaign,
    plannedGeo,
    plannedStructure,
    plannedGeoMaturity
  ]);

  const intelCampaignRows = useMemo(() => {
    if (!intel || !intel.liveGuidance) return [];

    return intel.liveGuidance.map((row) => {
      // First clone original row
      const normalized = normalizeIntelRow(row);

      // Keep original row fields if needed, but ensure normalized names overwrite
      return {
        ...row,
        ...normalized,
      };
    });
  }, [intel]);

  const intelStartPlanRows = useMemo(() => {
    if (!intel?.startPlans) return [];
    return intel.startPlans.map(plan => ({
      ...plan,
      campaign_id: plan.country,
      campaign_name: plan.name || plan.country,
      geo: plan.country,
      structure: plan.structure || "CBO",
      spend: plan.recommendedTotal,
      purchase_value: plan.recommendedTotal,
      purchases: plan.expectedPurchases,
      adset_id: null,
      adset_name: null
    }));
  }, [intel]);

  /* ----------------------------
     Platform rows for the configuration scope
     ---------------------------- */
  const platformCampaignRows = useMemo(() => {
    const rows = intelCampaignRows;
    // For planned with template, we use template campaign rows as anchor.
    if (activeConfig.planned && activeConfig.plannedSource === "meta_template" && activeConfig.campaignName) {
      return scopeFilterRows(rows, { campaignName: activeConfig.campaignName, geo: null, includeAdsets: true });
    }
    // Existing: filter by selected campaign + geo
    if (!activeConfig.planned && activeConfig.campaignName) {
      return scopeFilterRows(rows, { campaignName: activeConfig.campaignName, geo: activeConfig.geo, includeAdsets: true });
    }
    // Planned without template: no direct campaign rows
    return [];
  }, [activeConfig, intelCampaignRows]);

  const allBrandRows = useMemo(() => {
    // Used for priors fallback in planned new + thin.
    return [...intelCampaignRows, ...intelStartPlanRows];
  }, [intelCampaignRows, intelStartPlanRows]);

  /* ----------------------------
     Parse file packets into flat rows
     ---------------------------- */
  const existingUploadedRows = useMemo(() => {
    return (existingFilePackets || [])
      .filter(p => p.ok)
      .flatMap(p => p.rows)
      .map(DataValidator.coerceRow);
  }, [existingFilePackets]);

  const plannedUploadedRows = useMemo(() => {
    return (plannedFilePackets || [])
      .filter(p => p.ok)
      .flatMap(p => p.rows)
      .map(DataValidator.coerceRow);
  }, [plannedFilePackets]);

  /* ----------------------------
     Apply file precedence per scope
     ---------------------------- */
  const scopedRows = useMemo(() => {
    const manualAov = expectedAov;

    // Helper to normalize revenue in any rows
    const withNorm = (rows) =>
      (rows || []).map(r => {
        const nr = MathUtils.normalizeRevenueRow(r, manualAov);
        return { ...r, _normRevenue: nr.value, _revSource: nr.source };
      });

    if (scenarioType === "existing") {
      const base = withNorm(platformCampaignRows);

      if (existingUploadedRows.length) {
        const up = withNorm(existingUploadedRows);

        if (existingFileMode === "override") {
          return up;
        }
        // complement
        return DataValidator.mergeComplement(base, up).map(r => {
          const nr = MathUtils.normalizeRevenueRow(r, manualAov);
          return { ...r, _normRevenue: nr.value, _revSource: nr.source };
        });
      }
      return base;
    }

    // planned
    const base = withNorm(platformCampaignRows);

    if (plannedUploadedRows.length) {
      const up = withNorm(plannedUploadedRows);
      if (plannedFileMode === "override") {
        return up;
      }
      return DataValidator.mergeComplement(base, up).map(r => {
        const nr = MathUtils.normalizeRevenueRow(r, manualAov);
        return { ...r, _normRevenue: nr.value, _revSource: nr.source };
      });
    }

    return base;
  }, [
    scenarioType,
    platformCampaignRows,
    existingUploadedRows,
    plannedUploadedRows,
    existingFileMode,
    plannedFileMode,
    expectedAov
  ]);

  /* ----------------------------
     Lookback rows + Smart resolution label
     ---------------------------- */
  const lookbackRows = useMemo(() => {
    const rows = [...scopedRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const applied = applyLookback(rows, lookbackKey);
    if (lookbackKey === "smart") {
      const days = chooseSmartLookback(rows);
      setResolvedSmartDays(days || rows.length || 0);
    } else {
      setResolvedSmartDays(null);
    }
    return applied;
  }, [scopedRows, lookbackKey]);

  /* ----------------------------
     Determine ad sets for structure realism
     ---------------------------- */
  const activeAdsets = useMemo(() => {
    // For existing: ad sets from selected campaign
    if (scenarioType === "existing") {
      return intelCampaignRows.filter(r => r.campaign_name === existingCampaign && r.adset_id);
    }
    // For planned with template: ad sets from template
    if (plannedSource === "meta_template") {
      return intelCampaignRows.filter(r => r.campaign_name === plannedTemplateCampaign && r.adset_id);
    }
    // Planned new: create placeholder ad sets (editable in future backend)
    return [
      { id: "planned_ad_1", name: "Planned Adset 1" },
      { id: "planned_ad_2", name: "Planned Adset 2" }
    ];
  }, [scenarioType, existingCampaign, plannedSource, plannedTemplateCampaign, intelCampaignRows]);

  /* ----------------------------
     Compute dynamic slider bounds from recent campaign-level spends
     ---------------------------- */
  useEffect(() => {
    const campLevel = lookbackRows.filter(r => !r.adset_id && Number.isFinite(r.spend));
    const spends = campLevel.map(r => r.spend).filter(s => s > 0);
    if (spends.length >= 5) {
      const p10 = MathUtils.percentile(spends, 10) || 500;
      const p90 = MathUtils.percentile(spends, 90) || 5000;
      const min = Math.max(200, Math.round(p10 * 0.5 / 100) * 100);
      const max = Math.max(min + 500, Math.round(p90 * 2 / 100) * 100);
      setSliderBounds({ min, max, step: 100 });
      setDailyBudget(b => MathUtils.clamp(min, max, b));
    } else {
      setSliderBounds({ min: 500, max: 12000, step: 100 });
      setDailyBudget(b => MathUtils.clamp(500, 12000, b));
    }
  }, [lookbackRows]);

  /* ----------------------------
     Data health + sufficiency
     ---------------------------- */
  const dataHealth = useMemo(() => {
    const allRowsForLabel = scopedRows;
    return computeDataHealth({
      allRows: allRowsForLabel,
      lookbackRows,
      structure: activeConfig.structure,
      scenarioType
    });
  }, [scopedRows, lookbackRows, activeConfig.structure, scenarioType]);

  /* ----------------------------
     Auto-pick execution mode based on strategy + structure + sufficiency
     ---------------------------- */
  useEffect(() => {
    const why = [];
    let chosen = "curve_only";

    const structure = activeConfig.structure;
    const thin = dataHealth.confidence === "Low" || dataHealth.status.startsWith("🟡");

    const family = strategyKey;

    if (family === "abo_direct") {
      chosen = "curve_only";
      why.push("ABO strategy does not require allocation inference.");
    } else if (family === "structure_aware") {
      if (structure === "ABO") {
        chosen = "curve_only";
        why.push("ABO structure selected; allocation is irrelevant.");
      } else if (thin) {
        chosen = "hybrid";
        why.push("Thin data for CBO/ASC; blending priors + allocation assumptions.");
      } else {
        chosen = "curve_allocation";
        why.push("Adequate ad set history for CBO/ASC realism.");
      }
    } else if (family === "bayes_transfer") {
      if (structure === "ABO") {
        chosen = "curve_priors";
        why.push("Cold-start with ABO; priors are the main stabilizer.");
      } else {
        chosen = "hybrid";
        why.push("Cold-start with CBO/ASC; priors + allocation realism.");
      }
    } else if (family === "geo_pooling") {
      chosen = "hybrid";
      why.push("Multi-geo pooling benefits from shared priors + structure realism.");
    } else if (family === "mmm_lite") {
      chosen = "curve_only";
      why.push("Planning-focused curve mode; allocation is a secondary concern.");
    } else {
      chosen = "hybrid";
      why.push("Defaulting to best-available blend.");
    }

    // Incrementality mode is future-gated
    if (modeKeyManual === "incrementality") {
      chosen = "incrementality";
      why.push("Manual override: incrementality-calibrated (requires backend test inputs).");
    }

    setAutoModeKey(chosen);
    setAutoModeWhy(why);
  }, [strategyKey, activeConfig.structure, dataHealth, modeKeyManual]);

  /* ----------------------------
     Build modeling datasets:
     - Primary curve rows are campaign-level (no adset_id).
     - Allocation uses ad set-level rows.
     ---------------------------- */
  const curveRows = useMemo(() => {
    // For planned new with no template, we can still build priors from allBrandRows later.
    const base = lookbackRows.filter(r => !r.adset_id);
    return base;
  }, [lookbackRows]);

  const allocationRows = useMemo(() => {
    return lookbackRows.filter(r => r.adset_id);
  }, [lookbackRows]);

  /* ----------------------------
     Build Priors rows from reference campaigns (optional)
     ---------------------------- */
  const referenceRows = useMemo(() => {
    const refs = scenarioType === "existing" ? refCampaignsExisting : refCampaignsPlanned;
    if (!refs.length) return [];
    const all = allBrandRows;
    return all.filter(r => refs.includes(r.campaign_name));
  }, [scenarioType, refCampaignsExisting, refCampaignsPlanned, allBrandRows]);

  /* ----------------------------
     Construct effective rows for parameter estimation:
     - Existing: primarily curveRows, with light prior blending if references exist.
     - Planned:
     * meta_template -> curveRows from template
     * new -> use referenceRows if provided else brand-level pool.
     ---------------------------- */
  const estimationRows = useMemo(() => {
    if (scenarioType === "existing") {
      return curveRows.length ? curveRows : platformCampaignRows.filter(r => !r.adset_id);
    }

    // planned
    if (plannedSource === "meta_template") {
      return curveRows.length ? curveRows : platformCampaignRows.filter(r => !r.adset_id);
    }

    // Planned new
    if (referenceRows.length) {
      return referenceRows.filter(r => !r.adset_id);
    }

    // fallback to brand/global pool for demo
    return allBrandRows.filter(r => !r.adset_id);
  }, [
    scenarioType,
    curveRows,
    platformCampaignRows,
    plannedSource,
    referenceRows,
    allBrandRows
  ]);

  /* ----------------------------
     Precompute funnel historical bench for quality adjustment
     ---------------------------- */
  const historicalBench = useMemo(() => {
    const base = estimationRows.length ? estimationRows : curveRows;
    return MathUtils.buildHistoricalBench(base);
  }, [estimationRows, curveRows]);

  /* ----------------------------
     Compute parameters + adjustments
     ---------------------------- */
  const params = useMemo(() => {
    return MathUtils.estimateHillParams(estimationRows);
  }, [estimationRows]);

  const latestRow = useMemo(() => {
    const ordered = [...curveRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return ordered[ordered.length - 1] || null;
  }, [curveRows]);

  const adjustments = useMemo(() => {
    const currentRates = latestRow ? MathUtils.funnelRates(latestRow) : null;
    const qualityAdj = MathUtils.computeQualityAdj(currentRates, historicalBench);

    const creativeAdj = MathUtils.creativeAdj(
      latestRow?.active_creatives_count ?? activeCreatives,
      dailyBudget
    );

    const promoAdj = MathUtils.promoAdj(
      scenarioType === "planned" ? promoFlag : (latestRow?.promo_flag ?? 0),
      scenarioType === "planned" ? discountPct : (latestRow?.discount_pct ?? 0)
    );

    return { qualityAdj, creativeAdj, promoAdj };
  }, [
    latestRow,
    historicalBench,
    activeCreatives,
    dailyBudget,
    scenarioType,
    promoFlag,
    discountPct
  ]);

  /* ----------------------------
     Structure-aware prediction
     ---------------------------- */
  const allocationPlan = useMemo(() => {
    const structure = activeConfig.structure;
    const daily = dailyBudget;

    const adsets = activeAdsets;

    // For allocation inference, use allocationRows + platformCampaignRows adset rows.
    const lbAdRows =
      allocationRows.length
        ? allocationRows
        : platformCampaignRows.filter(r => r.adset_id);

    return MathUtils.allocateBudgetThin({
      structure,
      dailyBudget: daily,
      adsets,
      lookbackRows: lbAdRows
    });
  }, [activeConfig.structure, dailyBudget, activeAdsets, allocationRows, platformCampaignRows]);

  const predicted = useMemo(() => {
    const structure = activeConfig.structure;

    if (autoModeKey === "incrementality") {
      // Future backend hook.
      const naive = MathUtils.predictFromParams(dailyBudget, params, adjustments);
      return {
        meanDailyRevenue: naive * 0.85,
        roas: MathUtils.safeDivide(naive * 0.85, dailyBudget, 0),
        note: "Incrementality mode requires backend causal inputs; showing conservative placeholder."
      };
    }

    if (structure === "ABO" || autoModeKey === "curve_only" || autoModeKey === "curve_priors") {
      const rev = MathUtils.predictFromParams(dailyBudget, params, adjustments);
      return {
        meanDailyRevenue: rev,
        roas: MathUtils.safeDivide(rev, dailyBudget, 0),
        note: "Single-curve forecast."
      };
    }

    // CBO/ASC + allocation realism
    const adsetRevs = allocationPlan.map(a => {
      const r = MathUtils.predictFromParams(Math.max(0, a.budget), params, adjustments);
      return { ...a, predictedRevenue: r, predictedRoas: MathUtils.safeDivide(r, a.budget, 0) };
    });

    const totalRev = adsetRevs.reduce((s, a) => s + (a.predictedRevenue || 0), 0);

    return {
      meanDailyRevenue: totalRev,
      roas: MathUtils.safeDivide(totalRev, dailyBudget, 0),
      adsetRevs,
      note: "Budget → inferred ad set split → summed outcome."
    };
  }, [activeConfig.structure, autoModeKey, dailyBudget, params, adjustments, allocationPlan]);

  /* ----------------------------
     Budget recommendations (Max ROAS + Growth Knee)
     ---------------------------- */
  const recommendations = useMemo(() => {
    const min = sliderBounds.min;
    const max = sliderBounds.max;
    const step = Math.max(100, sliderBounds.step);

    const grid = MathUtils.scanBudgetGrid({ min, max, step, params, adj: adjustments });

    const maxRoas = MathUtils.findMaxRoas(grid);
    const knee = MathUtils.findGrowthKnee(grid);

    return { grid, maxRoas, knee };
  }, [sliderBounds, params, adjustments]);

  /* ----------------------------
     Helper: Campaign dropdown list
     ---------------------------- */
  const campaignOptions = useMemo(() => {
    if (metaCampaignNames.length) return metaCampaignNames;
    if (intelCampaignRows.length) {
      return Array.from(new Set(intelCampaignRows.map(r => r.campaign_name).filter(Boolean)));
    }
    return [];
  }, [metaCampaignNames, intelCampaignRows]);

  // Seed campaign selections when options change
  useEffect(() => {
    const first = campaignOptions[0];
    if (first && !campaignOptions.includes(existingCampaign)) {
      setExistingCampaign(first);
      const meta = intelCampaignRows.find(c => c.campaign_name === first);
      if (meta?.geo) setExistingGeo(meta.geo);
      if (meta?.structure) setExistingStructure(meta.structure);
    }

    if (first && !campaignOptions.includes(plannedTemplateCampaign)) {
      setPlannedTemplateCampaign(first);
    }

    if (intelStartPlanRows.length && (!plannedGeo || plannedGeo === "")) {
      setPlannedGeo(intelStartPlanRows[0].geo || intelStartPlanRows[0].country || plannedGeo);
    }
  }, [
    campaignOptions,
    existingCampaign,
    plannedTemplateCampaign,
    intelCampaignRows,
    intelStartPlanRows,
    plannedGeo,
    existingGeo,
    existingStructure
  ]);

  /* ----------------------------
     UI: reference campaign multi-select (simple)
     ---------------------------- */
  function MultiSelectCampaigns({ value, onChange, excludeName }) {
    const toggle = (name) => {
      if (excludeName && name === excludeName) return;
      const set = new Set(value || []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      onChange(Array.from(set));
    };

    return (
      <div className="rounded-xl border border-gray-200 p-3">
        <div className="text-[11px] font-bold text-gray-900 flex items-center gap-1">
          <Layers size={12} className="text-indigo-600" />
          Reference Campaigns
          <span className="text-[10px] text-gray-500 font-semibold">
            (optional priors boosters)
          </span>
        </div>
        <div className="text-[10px] text-gray-500 mt-1">
          Recommended type: same brand + objective + structure; prefer mature anchors for New/Thin geos.
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {campaignOptions.map(name => (
            <Pill
              key={name}
              active={(value || []).includes(name)}
              onClick={() => toggle(name)}
            >
              {name}
            </Pill>
          ))}
        </div>
      </div>
    );  }

  /* ----------------------------
     Render
     ---------------------------- */
  if (loadingIntel) {
    return <div>Loading…</div>;
  }
  if (intelError) {
    return <div>{intelError}</div>;
  }
  if (!intel) {
    return <div>No budget intelligence data available.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Scenario switch */}
      <div className="flex items-center gap-2">
        <Pill active={scenarioType === "existing"} onClick={() => setScenarioType("existing")}>
          📌 Existing Campaign
        </Pill>
        <Pill active={scenarioType === "planned"} onClick={() => setScenarioType("planned")}>
          ✨ Planned Campaign
        </Pill>
      </div>

      {/* CONFIGURATION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Configuration box */}
        <SectionCard
          title={scenarioType === "existing" ? "Existing Campaign Setup" : "Planned Campaign Setup"}
          subtitle="Select your scope, structure, geo maturity, and data add-ons."
          icon={<SlidersHorizontal size={16} className="text-indigo-600" />}
        >
          {scenarioType === "existing" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-900">Meta Campaign</div>
                  <select
                    value={existingCampaign}
                    onChange={(e) => {
                      const name = e.target.value;
                      setExistingCampaign(name);
                      const meta = intelCampaignRows.find(c => c.campaign_name === name);
                      if (meta) {
                        setExistingGeo(meta.geo);
                        setExistingStructure(meta.structure);
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  >
                    {campaignOptions.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Uses this campaign as the primary learning source.
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold text-gray-900">Geo</div>
                  <input
                    value={existingGeo}
                    onChange={(e) => setExistingGeo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  />
                  <div className="text-[10px] text-gray-500 mt-1">
                    In real backend, this is derived from campaign delivery.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-900">Structure</div>
                  <select
                    value={existingStructure}
                    onChange={(e) => setExistingStructure(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  >
                    <option value="ABO">ABO</option>
                    <option value="CBO">CBO</option>
                    <option value="ASC">ASC</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs font-bold text-gray-900">Geo Maturity</div>
                  <select
                    value={existingGeoMaturity}
                    onChange={(e) => setExistingGeoMaturity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  >
                    <option value="mature">Mature</option>
                    <option value="thin">New/Thin</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs font-bold text-gray-900">Lookback</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {LOOKBACK_OPTIONS.map(opt => (
                      <Pill
                        key={opt.key}
                        active={lookbackKey === opt.key}
                        onClick={() => setLookbackKey(opt.key)}
                      >
                        {opt.label}
                      </Pill>
                    ))}
                  </div>
                  {lookbackKey === "smart" ? (
                    <div className="text-[10px] text-gray-600 mt-1">
                      Auto-adjusts lookback based on data sufficiency + recent changes (typically ~14D).
                      <span className="font-semibold ml-1">
                        Smart selected: using {resolvedSmartDays ?? "…"} days.
                      </span>
                    </div>
                  ) : null}
                  {lookbackKey === "full" ? (
                    <div className="text-[10px] text-yellow-700 mt-1">
                      May reduce responsiveness to recent changes.
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Scoped uploads next to settings */}
              <MultiFileUpload
                label="Data Add-ons for this Existing Campaign"
                overrideMode={existingFileMode}
                setOverrideMode={setExistingFileMode}
                onFilesParsed={setExistingFilePackets}
                summary={
                  existingFilePackets.length
                    ? `${existingFilePackets.length} file(s) parsed. ${existingFilePackets.filter(p => p.ok).length} valid.`
                    : "Upload multiple CSVs if platform data is missing or needs correction."
                }
              />

              <MultiSelectCampaigns
                value={refCampaignsExisting}
                onChange={setRefCampaignsExisting}
                excludeName={existingCampaign}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 p-3">
                <div className="text-xs font-bold text-gray-900">Campaign Source</div>
                <div className="mt-2 flex items-center gap-2">
                  <Pill
                    active={plannedSource === "new"}
                    onClick={() => setPlannedSource("new")}
                  >
                    Create New Plan
                  </Pill>
                  <Pill
                    active={plannedSource === "meta_template"}
                    onClick={() => setPlannedSource("meta_template")}
                  >
                    Use Existing Meta Campaign as Template
                  </Pill>
                </div>

                {plannedSource === "meta_template" ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-bold text-gray-900">Template Campaign</div>
                    <select
                      value={plannedTemplateCampaign}
                      onChange={(e) => {
                        const name = e.target.value;
                        setPlannedTemplateCampaign(name);
                        const meta = intelCampaignRows.find(c => c.campaign_name === name);
                        if (meta) {
                          setPlannedGeo(meta.geo);
                          setPlannedStructure(meta.structure);
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                    >
                      {campaignOptions.map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Uses this campaign as the historical anchor for priors and structure realism.
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-900">Target Geo</div>
                  <input
                    value={plannedGeo}
                    onChange={(e) => setPlannedGeo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Structure</div>
                  <select
                    value={plannedStructure}
                    onChange={(e) => setPlannedStructure(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  >
                    <option value="ABO">ABO</option>
                    <option value="CBO">CBO</option>
                    <option value="ASC">ASC</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-900">Geo Maturity</div>
                  <select
                    value={plannedGeoMaturity}
                    onChange={(e) => setPlannedGeoMaturity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  >
                    <option value="mature">Mature</option>
                    <option value="thin">New/Thin</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Expected AOV</div>
                  <input
                    type="number"
                    value={expectedAov}
                    onChange={(e) => setExpectedAov(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Promo</div>
                  <select
                    value={promoFlag}
                    onChange={(e) => setPromoFlag(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  >
                    <option value={0}>No</option>
                    <option value={1}>Yes</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Discount %</div>
                  <input
                    type="number"
                    disabled={!promoFlag}
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs disabled:bg-gray-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-900">Active Creatives</div>
                  <input
                    type="number"
                    value={activeCreatives}
                    onChange={(e) => setActiveCreatives(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Lookback</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {LOOKBACK_OPTIONS.map(opt => (
                      <Pill
                        key={opt.key}
                        active={lookbackKey === opt.key}
                        onClick={() => setLookbackKey(opt.key)}
                      >
                        {opt.label}
                      </Pill>
                    ))}
                  </div>
                  {lookbackKey === "smart" ? (
                    <div className="text-[10px] text-gray-600 mt-1">
                      Auto-adjusts lookback based on data sufficiency + recent changes (typically ~14D).
                      <span className="font-semibold ml-1">
                        Smart selected: using {resolvedSmartDays ?? "…"} days.
                      </span>
                    </div>
                  ) : null}
                  {lookbackKey === "full" ? (
                    <div className="text-[10px] text-yellow-700 mt-1">
                      May reduce responsiveness to recent changes.
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Scoped uploads next to planned settings */}
              <MultiFileUpload
                label="Data Add-ons for this Planned Campaign"
                overrideMode={plannedFileMode}
                setOverrideMode={setPlannedFileMode}
                onFilesParsed={setPlannedFilePackets}
                summary={
                  plannedFilePackets.length
                    ? `${plannedFilePackets.length} file(s) parsed. ${plannedFilePackets.filter(p => p.ok).length} valid.`
                    : "Upload multiple CSVs if you want to inject priors or fix missing funnel fields."
                }
              />

              <MultiSelectCampaigns
                value={refCampaignsPlanned}
                onChange={setRefCampaignsPlanned}
                excludeName={plannedTemplateCampaign}
              />
            </div>
          )}
        </SectionCard>

        {/* Right: Strategy + Mode + Data Sufficiency */}
        <div className="space-y-4">
          <SectionCard
            title="Model Strategy"
            subtitle="Selects the forecasting approach family."
            icon={<Brain size={16} className="text-indigo-600" />}
          >
            <StrategySelector value={strategyKey} onChange={setStrategyKey} />
          </SectionCard>

          <SectionCard
            title="Model Execution Mode"
            subtitle="Auto-selected runtime engine variant based on your strategy + structure + data."
            icon={<Wand2 size={16} className="text-indigo-600" />}
            right={
              <div className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-full">
                Auto-recommended
              </div>
            }
          >
            <div className="space-y-2">
              {EXECUTION_MODES.map(m => (
                <ModeExplainRow key={m.key} modeKey={m.key} active={autoModeKey === m.key} />
              ))}
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-[11px] font-bold text-gray-900 flex items-center gap-1">
                <Info size={12} className="text-indigo-600" />
                Why this mode was chosen
              </div>
              <ul className="mt-1 text-[10px] text-gray-700 space-y-0.5">
                {autoModeWhy.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          </SectionCard>

          <SectionCard
            title="Data Sufficiency Advisor"
            subtitle="Tells you exactly if what you provided is enough, and what to add if not."
            icon={<Database size={16} className="text-indigo-600" />}
          >
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold text-gray-900">{dataHealth.status}</div>
                <div className={[
                  "text-[10px] font-bold px-2 py-0.5 rounded-full",
                  dataHealth.confidence === "High"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : dataHealth.confidence === "Medium"
                    ? "bg-yellow-50 text-yellow-700 border border-yellow-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                ].join(" ")}>
                  Confidence: {dataHealth.confidence}
                </div>
              </div>

              <div className="mt-2 text-[10px] text-gray-600">
                <div>Primary: {scenarioType === "existing" ? "Selected campaign" : (plannedSource === "meta_template" ? "Template campaign" : "Priors + references")}</div>
                <div>Files: {scenarioType === "existing" ? existingFileMode : plannedFileMode} ({scenarioType === "existing" ? existingFilePackets.length : plannedFilePackets.length} file(s))</div>
                <div>Structure: {activeConfig.structure}</div>
              </div>

              <p className="text-xs text-gray-500">
                Rows used for math: {Array.isArray(platformCampaignRows) ? platformCampaignRows.length : 0}
              </p>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-200 bg-white p-2">
                  <div className="text-[9px] text-gray-500">All-Time Coverage Days</div>
                  <div className="text-[11px] font-bold text-gray-900">{dataHealth.allTimeDays}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-2">
                  <div className="text-[9px] text-gray-500">Lookback Rows Used</div>
                  <div className="text-[11px] font-bold text-gray-900">{dataHealth.lookbackUsed}</div>
                </div>
              </div>

              {dataHealth.missing?.length ? (
                <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-2">
                  <div className="text-[10px] font-bold text-yellow-800">What you need to add</div>
                  <ul className="mt-1 text-[10px] text-yellow-800 space-y-0.5">
                    {dataHealth.missing.map((m, i) => (
                      <li key={i}>• {m}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-2">
                  <div className="text-[10px] font-bold text-green-800">
                    Looks sufficient for this configuration.
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* BUDGET SLIDER + INLINE RESULTS */}
      <SectionCard
        title="Budget Simulator"
        subtitle="Max ROAS = best efficiency per riyal. Growth Knee = best balance of scale + efficiency."
        icon={<BarChart3 size={16} className="text-indigo-600" />}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Slider */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-900">
                  Daily Budget ({activeConfig.structure})
                </div>
                <div className="text-lg font-extrabold text-indigo-600">
                  {Number(dailyBudget).toLocaleString()} SAR/day
                </div>
              </div>

              <input
                type="range"
                min={sliderBounds.min}
                max={sliderBounds.max}
                step={sliderBounds.step}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(Number(e.target.value))}
                className="w-full mt-3 accent-indigo-600"
              />

              <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1">
                <span>{sliderBounds.min.toLocaleString()}</span>
                <span>{sliderBounds.max.toLocaleString()}</span>
              </div>

              {/* Results directly under slider */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[9px] text-gray-500">Projected Revenue (Daily)</div>
                  <div className="text-sm font-extrabold text-gray-900">
                    {Math.round(predicted.meanDailyRevenue || 0).toLocaleString()} SAR
                  </div>
                  <div className="text-[9px] text-gray-500 mt-0.5">
                    {predicted.note}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[9px] text-gray-500">Expected ROAS</div>
                  <div className="text-sm font-extrabold text-indigo-700">
                    {Number(predicted.roas || 0).toFixed(2)}x
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[9px] text-gray-500">Confidence</div>
                  <div className="text-sm font-extrabold text-gray-900">
                    {dataHealth.confidence}
                  </div>
                </div>
              </div>

              {/* Recommended budgets */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <div className="text-[11px] font-extrabold text-indigo-900">
                    🏆 Recommended (Max ROAS)
                  </div>
                  <div className="text-xs text-indigo-800 mt-0.5">
                    Best efficiency per riyal.
                  </div>
                  <div className="text-xl font-extrabold text-gray-900 mt-1">
                    {Math.round(recommendations.maxRoas?.spend || 0).toLocaleString()} SAR/day
                  </div>
                  <div className="text-[11px] text-gray-700">
                    Estimated ROAS: {Number(recommendations.maxRoas?.roas || 0).toFixed(2)}x
                  </div>
                  <button
                    type="button"
                    onClick={() => recommendations.maxRoas && setDailyBudget(recommendations.maxRoas.spend)}
                    className="mt-2 text-[11px] font-bold text-indigo-700 underline"
                  >
                    Set slider
                  </button>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="text-[11px] font-extrabold text-blue-900">
                    🚀 Recommended (Growth Knee)
                  </div>
                  <div className="text-xs text-blue-800 mt-0.5">
                    Best balance of scale + efficiency.
                  </div>
                  <div className="text-xl font-extrabold text-gray-900 mt-1">
                    {Math.round(recommendations.knee?.spend || 0).toLocaleString()} SAR/day
                  </div>
                  <div className="text-[11px] text-gray-700">
                    Estimated ROAS: {Number(recommendations.knee?.roas || 0).toFixed(2)}x
                  </div>
                  <button
                    type="button"
                    onClick={() => recommendations.knee && setDailyBudget(recommendations.knee.spend)}
                    className="mt-2 text-[11px] font-bold text-blue-700 underline"
                  >
                    Set slider
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sanity / Data points used */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
              <div className="text-xs font-extrabold text-gray-900 flex items-center gap-1">
                <FileText size={12} className="text-indigo-600" />
                Sanity Check — Data Points Used
              </div>
              <div className="text-[10px] text-gray-600 mt-1">
                The model uses these lookback aggregates for this run.
              </div>

              <div className="mt-3 space-y-2">
                <MiniMetric label="Lookback Days Used" value={dataHealth.lookbackUsed} />
                <MiniMetric label="Spend Days (lookback)" value={dataHealth.spendDays} />
                <MiniMetric label="Revenue Source (latest)" value={latestRow?._revSource || "n/a"} />
                <MiniMetric label="Funnel Complete?" value={dataHealth.hasFunnel ? "Yes" : "No"} />
                <MiniMetric label="Ad Set History (CBO/ASC)?" value={(activeConfig.structure !== "ABO" && dataHealth.hasAdsetSpend) ? "Yes" : (activeConfig.structure === "ABO" ? "n/a" : "No")} />
              </div>

              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-2">
                <div className="text-[10px] font-bold text-gray-900">Latest Funnel Snapshot</div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <MiniMetric label="Impressions" value={latestRow?.impressions ?? "—"} />
                  <MiniMetric label="Clicks" value={latestRow?.clicks ?? "—"} />
                  <MiniMetric label="ATC" value={latestRow?.atc ?? "—"} />
                  <MiniMetric label="IC" value={latestRow?.ic ?? "—"} />
                  <MiniMetric label="Purchases" value={latestRow?.purchases ?? "—"} />
                  <MiniMetric label="AOV (manual)" value={expectedAov} />
                </div>
              </div>

              {predicted.adsetRevs?.length ? (
                <div className="mt-3">
                  <div className="text-[10px] font-bold text-gray-900">
                    Allocation Preview ({activeConfig.structure})
                  </div>
                  <div className="text-[9px] text-gray-500">
                    Budget split source: {predicted.adsetRevs[0]?.shareSource || "n/a"}
                  </div>
                  <div className="mt-1 space-y-1 max-h-56 overflow-auto">
                    {predicted.adsetRevs.map(a => (
                      <div key={a.id} className="rounded-md border border-gray-200 bg-white px-2 py-1">
                        <div className="text-[10px] font-semibold text-gray-900">{a.name}</div>
                        <div className="text-[9px] text-gray-600">
                          Budget: {Math.round(a.budget).toLocaleString()} • ROAS: {Number(a.predictedRoas || 0).toFixed(2)}x
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-1.5">
      <div className="text-[9px] text-gray-500">{label}</div>
      <div className="text-[11px] font-bold text-gray-900">
        {typeof value === "number" ? value.toLocaleString() : String(value)}
      </div>
    </div>
  );
}

/* ============================================================================
   MATH FLOW TAB (educational, config-aware)
   ============================================================================ */

function AIBudgetMathFlowTab() {
  return (
    <div className="space-y-4">
      <SectionCard
        title="Math Flow (Config-Aware)"
        subtitle="This tab is an educational map of how the simulator computes results."
        icon={<Calculator size={16} className="text-indigo-600" />}
      >
        <div className="text-xs text-gray-700">
          This demo file shows the structure of the math pipeline. In your production
          version, this panel should render live selections and computed intermediates:
          chosen Strategy, auto Mode, Smart lookback resolution, data precedence, curve
          parameters, allocation shares, adjustments, and confidence breakdown.
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="text-xs font-extrabold text-gray-900">
              1) Data Precedence (Locked)
            </div>
            <ul className="mt-2 text-[11px] text-gray-700 space-y-1">
              <li>• Platform (your DB-fed Meta + creative data)</li>
              <li>• CSV Override (replaces platform rows for this config scope)</li>
              <li>• CSV Complement (fills missing columns/days)</li>
              <li>• Manual inputs (AOV, promo, creatives)</li>
              <li>• Priors (reference campaigns, then brand/geo pools)</li>
            </ul>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="text-xs font-extrabold text-gray-900">
              2) Lookback Resolution
            </div>
            <ul className="mt-2 text-[11px] text-gray-700 space-y-1">
              <li>• Smart chooses a conservative window based on sufficiency.</li>
              <li>• 14/30/90 are fixed windows.</li>
              <li>• Full History is allowed with a recency warning.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="text-xs font-extrabold text-gray-900">
              3) Strategy → Auto Mode Selection
            </div>
            <ul className="mt-2 text-[11px] text-gray-700 space-y-1">
              <li>• Strategy defines the modeling family (the approach).</li>
              <li>• Mode defines the engine variant for today’s run.</li>
              <li>• Auto selection considers structure + data confidence.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="text-xs font-extrabold text-gray-900">
              4) Structure-Aware Forecasting
            </div>
            <ul className="mt-2 text-[11px] text-gray-700 space-y-1">
              <li>• ABO: slider is treated as an ad set envelope.</li>
              <li>• CBO/ASC: slider → inferred ad set split → summed outcome.</li>
              <li>• Cold-start CBO/ASC: equal split fallback with explicit low confidence.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50 lg:col-span-2">
            <div className="text-xs font-extrabold text-gray-900">
              5) Recommendations
            </div>
            <div className="text-[11px] text-gray-700 mt-2">
              Max ROAS is computed as the highest efficiency point on a scanned budget grid.
              Growth Knee is identified where marginal returns fall meaningfully below the
              best efficiency regime — intended as the scale/efficiency tradeoff sweet spot.
              In production, you may upgrade the knee detection to a second-derivative or
              elbow-detection approach.
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ============================================================================
   ROOT APP
   ============================================================================ */

export default function AIBudgetApp({ store }) {
  const [activeTab, setActiveTab] = useState("sim");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Brain size={18} className="text-white" />
            </div>
            <div>
              <div className="text-2xl font-extrabold text-gray-900">
                AI Budget Simulator
              </div>
              <div className="text-xs text-gray-500">
                Structure-aware forecasting with explicit data sufficiency + priors control
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Pill active={activeTab === "sim"} onClick={() => setActiveTab("sim")}>
              📊 Simulator
            </Pill>
            <Pill active={activeTab === "math"} onClick={() => setActiveTab("math")}>
              🧮 Math Flow
            </Pill>
          </div>
        </div>

        {activeTab === "sim" ? <AIBudgetSimulatorTab store={store} /> : <AIBudgetMathFlowTab />}

        <div className="text-[10px] text-gray-400">
          Demo shell connected to backend budget intelligence data.
          Allocation, priors, and incrementality layers are designed to upgrade cleanly
          with backend support.
        </div>
      </div>
    </div>
  );
}
