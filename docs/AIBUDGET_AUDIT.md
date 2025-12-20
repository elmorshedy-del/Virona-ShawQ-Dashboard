# AIBudget Tab Full Audit Report

**Date:** December 20, 2025  
**Status:** Critical Issues Identified  
**Recommendation:** Fix data flow issues before assessing feature value

---

## Executive Summary

The AIBudget tab has **critical data flow issues** that cause the Data Sufficiency Advisor and Sanity Check to display incorrect or zero values. The feature concept is valuable, but the implementation has fundamental problems that make it unreliable.

---

## 1. How AIBudget Gets Its Data

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT (AIBudget.jsx)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. TWO PARALLEL API CALLS ON MOUNT:                                        │
│     ┌─────────────────────────┐    ┌──────────────────────────────────┐    │
│     │ /api/aibudget           │    │ /api/budget-intelligence         │    │
│     │ ?store={store}          │    │ ?store={store}&includeInactive   │    │
│     └─────────────────────────┘    └──────────────────────────────────┘    │
│              │                                │                              │
│              ▼                                ▼                              │
│     ┌─────────────────────────┐    ┌──────────────────────────────────┐    │
│     │ aiDataset               │    │ intel                            │    │
│     │ - hierarchy.campaigns   │    │ - liveGuidance[]                 │    │
│     │ - hierarchy.adsets      │    │ - startPlans[]                   │    │
│     │ - metrics.campaignDaily │    │ - priors                         │    │
│     │ - metrics.adsetDaily    │    │ - learningMap                    │    │
│     │ - metrics.adDaily       │    │ - countryStats                   │    │
│     └─────────────────────────┘    └──────────────────────────────────┘    │
│                                                                              │
│  2. DATA MERGING (problematic):                                             │
│     ┌────────────────────────────────────────────────────────────────┐     │
│     │ datasetRows = aiDataset.metrics → mapped to flat row format    │     │
│     │ intelCampaignRows = intel.liveGuidance → mapped (different)    │     │
│     │                                                                │     │
│     │ platformCampaignRows = datasetRows.length ? datasetRows        │     │
│     │                                          : intelCampaignRows   │     │
│     │                        → FILTERED by campaign + geo            │     │
│     └────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  3. SCOPED ROWS (applied lookback + file uploads):                          │
│     scopedRows → lookbackRows → dataHealth calculation                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Server-Side Data Sources

| Endpoint | Service | Database Tables |
|----------|---------|-----------------|
| `/api/aibudget` | `aiBudgetService.js` | `meta_daily_metrics`, `meta_adset_metrics`, `meta_ad_metrics`, `meta_objects` |
| `/api/budget-intelligence` | `budgetIntelligenceService.js` | `meta_daily_metrics`, `meta_adset_metrics`, `salla_orders`/`shopify_orders`, `manual_orders` |

---

## 2. Why Data Sufficiency Advisor Shows Incorrect Info

### Issue #1: Campaign-Level Row Filtering Bug

**Location:** `AIBudget.jsx` lines 548-559

```javascript
// Count UNIQUE dates with campaign-level spend (not rows, since data has country breakdowns)
const spendDays = new Set(
  (lookbackRows || [])
    .filter(r => !r.adset_id && r.spend > 0)  // ⚠️ PROBLEM: filters for !adset_id
    .map(r => r.date)
).size;
```

**Problem:** The filter `!r.adset_id` expects campaign-level rows to NOT have an `adset_id`. But:
- `datasetRows` includes BOTH campaign-level AND adset-level rows (they're mapped separately)
- When `datasetRows` is empty and falls back to `intelCampaignRows`, those rows also have mixed `adset_id` presence

**Result:** `spendDays` and `revenueDays` often show as **0** even when data exists.

### Issue #2: Revenue Normalization Never Applied to Source Data

**Location:** `AIBudget.jsx` lines 565-566

```javascript
const hasRevenue = (lookbackRows || []).some(r => 
  Number.isFinite(r._normRevenue) && r._normRevenue > 0
);
```

**Problem:** `_normRevenue` is only added during the `scopedRows` computation (line 1112), but the data from `datasetRows` is mapped before this. If `platformCampaignRows` is empty (common when campaign filtering fails), `scopedRows` is empty, and `lookbackRows` is empty.

**Result:** `hasRevenue` returns `false` even when `purchase_value` or `conversions` data exists.

### Issue #3: Campaign Name Mismatch

**Location:** `AIBudget.jsx` lines 1072-1075

```javascript
if (!activeConfig.planned && activeConfig.campaignName) {
  return scopeFilterRows(rows, { 
    campaignName: activeConfig.campaignName,  // ⚠️ Must match EXACTLY
    geo: activeConfig.geo, 
    includeAdsets: true 
  });
}
```

**Problem:** The `scopeFilterRows` function requires an **exact string match**:

```javascript
function scopeFilterRows(rows, { campaignName, geo, includeAdsets = true }) {
  let out = rows || [];
  if (campaignName) out = out.filter(r => r.campaign_name === campaignName);  // EXACT MATCH
  ...
}
```

But campaign names come from two different sources:
- `aiDataset.hierarchy.campaigns[].object_name` or `.campaign_name` or `.name`
- `intel.liveGuidance[].campaignName`

These may not match if data is synced at different times or has different formatting.

**Result:** Filtering returns empty array → `scopedRows` is empty → all metrics show 0.

### Issue #4: Threshold Logic Inconsistency

**Location:** `AIBudget.jsx` lines 589-605

```javascript
if (lookbackDays >= 14 && spendDays >= 10) {
  status = "✅ Enough for Full Model";
  confidence = hasFunnel && (structure === "ABO" || hasAdsetSpend) ? "High" : "Medium";
} else if (lookbackDays >= 7 && spendDays >= 5) {
  status = "🟡 Enough for Partial Model";
  // ...
} else {
  status = "🚫 Not Enough";
  // ...
}
```

**Problem:** The thresholds compare:
- `lookbackDays` = unique dates in ALL rows
- `spendDays` = unique dates in campaign-level rows only

When data has country breakdowns (SA, AE, etc.), each date has multiple rows. But `spendDays` only counts campaign-level rows, which may not exist if data is only at adset level.

**Result:** User might have 14+ days of adset-level data with spend, but shows "🚫 Not Enough" because campaign-level rows are missing.

---

## 3. Why Sanity Check Shows Incorrect Info

### Issue #1: All Values Derive from `lookbackRows`

**Location:** `AIBudget.jsx` lines 2164-2173

```jsx
<MiniMetric label="Lookback Days (unique)" value={dataHealth.lookbackDays} />
<MiniMetric label="Spend Days" value={dataHealth.spendDays} />
<MiniMetric label="Revenue Days" value={dataHealth.revenueDays} />
<MiniMetric label="Data Rows" value={dataHealth.lookbackUsed} />
```

All these values come from `dataHealth`, which depends on `lookbackRows`. If the campaign filtering chain fails (as described above), all show **0**.

### Issue #2: Latest Row Missing

**Location:** `AIBudget.jsx` lines 2178-2185

```jsx
<MiniMetric label="Impressions" value={latestRow?.impressions ?? "—"} />
<MiniMetric label="Clicks" value={latestRow?.clicks ?? "—"} />
```

`latestRow` comes from:
```javascript
const latestRow = useMemo(() => {
  const ordered = [...curveRows].sort(...);
  return ordered[ordered.length - 1] || null;
}, [curveRows]);
```

And `curveRows` is:
```javascript
const curveRows = useMemo(() => {
  const base = lookbackRows.filter(r => !r.adset_id);  // ⚠️ Same filter problem
  return base;
}, [lookbackRows]);
```

**Result:** `latestRow` is often `null`, showing "—" for all funnel metrics.

### Issue #3: Revenue Source Always "n/a"

The sanity check shows:
```jsx
<MiniMetric label="Revenue Source (latest)" value={latestRow?._revSource || "n/a"} />
```

Since `latestRow` is often null (per Issue #2), this always shows "n/a".

---

## 4. Overall Feature Value Assessment

### What the Feature Is Supposed to Do

1. **Budget Simulator** - Predict revenue at different budget levels using Hill curves
2. **Data Sufficiency Advisor** - Tell users if they have enough data for reliable predictions
3. **Strategy Selection** - Choose appropriate forecasting approach based on campaign structure
4. **Sanity Check** - Show what data the model is actually using

### Current Value: LOW (Due to Implementation Issues)

| Aspect | Rating | Reason |
|--------|--------|--------|
| Concept | ✅ High | Budget forecasting is valuable for ad optimization |
| Math Implementation | ⚠️ Medium | Hill curves and adjustments are reasonable but untested with real data |
| Data Pipeline | ❌ Low | Multiple broken data flow paths make predictions unreliable |
| UX | ⚠️ Medium | UI is clean but shows misleading "0" values |
| Actionability | ❌ Low | Users can't trust predictions if data indicators are wrong |

### Potential Value If Fixed: HIGH

Budget forecasting aligned with campaign structure (ABO/CBO/ASC) is genuinely useful for:
- Daily budget decisions
- Scaling decisions
- New market planning
- ROAS optimization

---

## 5. Recommended Fixes

### Priority 1: Fix Data Flow Chain (Critical)

**A. Unify Row Mapping**

Create a single, consistent row format that both data sources produce:

```javascript
// In aiBudgetService.js - add explicit row type marker
{
  ...row,
  _rowLevel: 'campaign' | 'adset' | 'ad',  // Explicit level marker
  _source: 'aiDataset' | 'intel'           // Source tracking
}
```

**B. Fix Campaign Filtering**

Change from exact match to includes/normalized match:

```javascript
function scopeFilterRows(rows, { campaignName, geo, includeAdsets = true }) {
  let out = rows || [];
  if (campaignName) {
    const normalizedName = campaignName.toLowerCase().trim();
    out = out.filter(r => {
      const rowName = (r.campaign_name || '').toLowerCase().trim();
      return rowName === normalizedName || rowName.includes(normalizedName);
    });
  }
  // ...
}
```

**C. Fix spendDays/revenueDays Calculation**

Use explicit level marker instead of `!adset_id`:

```javascript
const spendDays = new Set(
  (lookbackRows || [])
    .filter(r => (r._rowLevel === 'campaign' || !r.adset_id) && r.spend > 0)
    .map(r => r.date)
).size;
```

### Priority 2: Add Data Validation (High)

Add console logging to debug data flow:

```javascript
useEffect(() => {
  console.log('[AIBudget Debug]', {
    aiDatasetMetrics: aiDataset?.metrics,
    datasetRowsCount: datasetRows.length,
    intelCampaignRowsCount: intelCampaignRows.length,
    platformCampaignRowsCount: platformCampaignRows.length,
    scopedRowsCount: scopedRows.length,
    lookbackRowsCount: lookbackRows.length,
    selectedCampaign: existingCampaign,
    availableCampaigns: campaignOptions
  });
}, [aiDataset, datasetRows, intelCampaignRows, platformCampaignRows, scopedRows, lookbackRows, existingCampaign, campaignOptions]);
```

### Priority 3: Add Fallback Display (Medium)

When data shows 0, indicate WHY:

```javascript
{dataHealth.lookbackUsed === 0 && (
  <div className="text-yellow-600 text-xs mt-2">
    ⚠️ No data after filtering. Check campaign selection matches available data.
    <br />
    Available campaigns: {campaignOptions.slice(0, 3).join(', ')}...
    <br />
    Selected: "{existingCampaign}"
  </div>
)}
```

### Priority 4: Consider Simplification (Long-term)

The dual-fetch architecture (aiDataset + intel) adds complexity. Consider:
- Single unified endpoint for AIBudget data
- Or clearly define which endpoint provides what, and don't mix

---

## 6. Code Locations Reference

| Issue | File | Lines |
|-------|------|-------|
| spendDays calculation | `client/src/components/AIBudget.jsx` | 548-552 |
| revenueDays calculation | `client/src/components/AIBudget.jsx` | 555-559 |
| hasRevenue check | `client/src/components/AIBudget.jsx` | 565-566 |
| scopeFilterRows | `client/src/components/AIBudget.jsx` | 628-634 |
| platformCampaignRows | `client/src/components/AIBudget.jsx` | 1066-1078 |
| scopedRows | `client/src/components/AIBudget.jsx` | 1106-1157 |
| computeDataHealth | `client/src/components/AIBudget.jsx` | 543-622 |
| dataHealth useMemo | `client/src/components/AIBudget.jsx` | 1215-1223 |
| Sanity Check UI | `client/src/components/AIBudget.jsx` | 2155-2207 |
| API endpoint aibudget | `server/routes/aibudget.js` | 12-42 |
| API endpoint budget-intel | `server/routes/budgetIntelligence.js` | 12-29 |
| aiBudgetService | `server/services/aiBudgetService.js` | 23-83 |
| budgetIntelligenceService | `server/services/budgetIntelligenceService.js` | 114-533 |

---

## 7. Conclusion

The AIBudget tab is a **valuable concept** with a **broken implementation**. The Data Sufficiency Advisor and Sanity Check showing incorrect values is caused by a fragile data flow chain where:

1. Two API endpoints return differently-structured data
2. Campaign name exact matching fails silently
3. Row-level filtering assumes consistent data structure that doesn't exist
4. No error feedback when data chains break

**Recommendation:** Fix the critical data flow issues before evaluating whether to keep or remove the feature. The underlying math (Hill curves, adjustments, etc.) appears sound but is untestable while the data pipeline is broken.

---

*Audit completed by analyzing: AIBudget.jsx (2357 lines), aibudget.js, aiBudgetService.js, aiBudgetDataAdapter.js, budgetIntelligenceService.js, budgetIntelligence.js, database.js, and related meta-awareness modules.*
