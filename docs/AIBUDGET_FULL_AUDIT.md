# AI Budget Feature - Complete Technical & Logical Audit

**Date:** December 20, 2025  
**Auditor:** Claude AI  
**Status:** Comprehensive Review Complete

---

## Executive Summary

The AI Budget feature is a **sophisticated budget simulator** that uses Hill curve modeling to predict revenue at different spend levels. The concept is valuable, but the implementation has several issues that need attention:

| Aspect | Status | Notes |
|--------|--------|-------|
| **Core Math** | ✅ Sound | Hill curves, adjustments, and recommendations logic are correct |
| **Backend Services** | ✅ Good | Well-structured, caching, parallel queries |
| **Database Schema** | ✅ Solid | All required fields present, proper indexes |
| **Data Flow** | ⚠️ Issues | Multiple sources with different formats cause filtering problems |
| **Frontend** | ⚠️ Complex | 2570+ lines in single component, needs refactoring |
| **User Experience** | ⚠️ Confusing | Data sufficiency often shows 0 due to filtering bugs |

---

## 1. Architecture Overview

### Component Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    AIBudget.jsx (2570 lines)                         │    │
│  │  • Budget Simulator Tab                                              │    │
│  │  • Math Flow Tab                                                     │    │
│  │  • Strategy/Mode Selection                                           │    │
│  │  • Data Sufficiency Advisor                                          │    │
│  │  • Hill Curve Math Utilities (MathUtils)                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│              ┌───────────────┴───────────────┐                              │
│              ▼                               ▼                              │
│     /api/aibudget                  /api/budget-intelligence                 │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
│                                                                              │
│  ┌──────────────────────┐    ┌────────────────────────────────────────┐    │
│  │  aiBudgetService.js  │    │    budgetIntelligenceService.js        │    │
│  │  • getData()         │    │    • getBudgetIntelligence()           │    │
│  │  • getHierarchy()    │    │    • Bayesian posteriors               │    │
│  │  • getMetrics()      │    │    • Start plans                       │    │
│  │  • 5-min cache       │    │    • Live guidance                     │    │
│  └──────────────────────┘    └────────────────────────────────────────┘    │
│              │                               │                              │
│              └───────────────┬───────────────┘                              │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        SQLite Database                               │    │
│  │  • meta_daily_metrics    (campaign-level daily data)                 │    │
│  │  • meta_adset_metrics    (ad set-level daily data)                   │    │
│  │  • meta_ad_metrics       (ad-level daily data)                       │    │
│  │  • meta_objects          (hierarchy with status)                     │    │
│  │  • salla_orders / shopify_orders (e-commerce data)                   │    │
│  │  • manual_orders         (manual attribution data)                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Services Audit

### 2.1 aiBudgetService.js ✅ GOOD

**Purpose:** Unified data pipeline for AI Budget - fetches hierarchy + metrics + meta-awareness data.

**Strengths:**
- Clean class-based design with caching (5-minute TTL)
- Parallel fetching with `Promise.all()`
- Proper date range calculation with fallbacks
- Integrates meta-awareness for reactivation insights

**Code Quality:**
```javascript
// Good: Parallel fetching
const [hierarchy, metrics, metaAwareness] = await Promise.all([
  this.getHierarchy(db, store, includeInactive),
  this.getMetrics(db, store, effectiveStart, effectiveEnd, includeInactive),
  this.getMetaAwarenessData(store, { includeReactivation: true })
]);
```

**Minor Issues:**
- `flattenMetrics()` only processes campaign-level data (line 247-272), ignoring adset/ad rows
- Status filter allows `UNKNOWN` and `NULL` which may include invalid data

### 2.2 budgetIntelligenceService.js ✅ GOOD

**Purpose:** Budget intelligence with Bayesian priors, live guidance, and start plans.

**Strengths:**
- Sophisticated Bayesian posterior computation
- Brand-specific constants (fallback CAC, target ROAS)
- Probability-based action recommendations (Scale/Hold/Cut)
- Proper aggregation by campaign and ad set

**Math Implementation (Correct):**
```javascript
// Bayesian posterior with weighted priors
function computePosterior(priorMean, priorWeight, observedMean, effectiveN) {
  const observed = observedMean == null ? priorMean : observedMean;
  const weight = effectiveN >= 20 ? 3 : priorWeight;  // More data = less prior weight
  const obsWeight = effectiveN || 1;
  return ((priorMean * weight) + (observed * obsWeight)) / (weight + obsWeight);
}
```

**Issues:**
- Uses `conversion_value` instead of `purchase_value` (inconsistent with frontend expectations)
- Start plans use hardcoded 4-day test period
- Currency handling is limited (only SAR and USD)

### 2.3 aiBudgetDataAdapter.js ✅ GOOD

**Purpose:** Lightweight adapter for weekly aggregation.

**Strengths:**
- Simple and focused
- Proper date range calculation
- Type coercion for numeric fields

**Issue:**
- `4weeks` uses 28 days but `1month` uses 30 - inconsistent

### 2.4 weeklyAggregationService.js ✅ GOOD

**Purpose:** Weekly data aggregation with trends.

**Strengths:**
- Clean aggregation logic
- Week-over-week trend calculation
- Campaign-level summaries

---

## 3. Frontend Audit (AIBudget.jsx)

### 3.1 Component Structure ⚠️ NEEDS REFACTORING

**Problem:** Single 2570-line component is too complex.

**Recommended Split:**
```
AIBudget/
├── AIBudgetApp.jsx           (root component with tabs)
├── SimulatorTab/
│   ├── ConfigurationSection.jsx
│   ├── StrategySelector.jsx
│   ├── DataSufficiencyAdvisor.jsx
│   ├── BudgetSlider.jsx
│   └── RecommendationsPanel.jsx
├── MathFlowTab.jsx
├── hooks/
│   ├── useAIBudgetData.js
│   ├── useBudgetPrediction.js
│   └── useDataHealth.js
└── utils/
    ├── mathUtils.js
    └── dataValidation.js
```

### 3.2 Math Utilities ✅ CORRECT

**Hill Curve Implementation:**
```javascript
hill(adstock, alpha, k, gamma = 1) {
  if (!Number.isFinite(adstock) || adstock <= 0) return 0;
  const num = Math.pow(adstock, gamma);
  const den = Math.pow(k, gamma) + num;
  return alpha * MathUtils.safeDivide(num, den, 0);
}
```

This is the standard Hill function: `revenue = alpha * (adstock^gamma) / (k^gamma + adstock^gamma)`

**Parameter Estimation (Fixed):**
```javascript
// Correct inversion for gamma=1:
// revenue = alpha * (X / (k + X))  => alpha = revenue * (k + X) / X
const alpha = Math.max(
  100,
  meanAd > 0 ? meanRev * (k + meanAd) / meanAd : meanRev * 2
);
```

**Adjustments (All Correct):**
| Adjustment | Formula | Range | Purpose |
|------------|---------|-------|---------|
| Quality Adj | Z-score from funnel rates | 0.8 - 1.25 | Adjust for funnel performance |
| Creative Adj | Based on creatives per $1k spend | 0.7 - 1.0 | Penalty for creative fatigue |
| Promo Adj | Convex lift from discount % | 1.0 - 1.35 | Boost for promotions |

### 3.3 Data Flow Issues ⚠️ FIXED BUT STILL FRAGILE

**Problem:** Two API sources with different formats:

| Field | `/api/aibudget` | `/api/budget-intelligence` |
|-------|-----------------|---------------------------|
| Revenue | `conversion_value` | `revenue` |
| Purchases | `conversions` | `purchases` |
| Campaign ID | `campaign_id` | `campaignId` (camelCase) |
| Ad Set ID | `adset_id` | `adsetId` (camelCase) |

**Current Fix (Applied):**
```javascript
// intelCampaignRows mapping now explicit
{
  date: row.date || row.startDate || row.endDate,
  campaign_id: row.campaignId,
  campaign_name: row.campaignName,
  purchase_value: row.revenue || 0,
  purchases: row.purchases || 0,
  spend: row.spend || 0,
  // ... etc
}
```

### 3.4 Data Sufficiency Calculation ⚠️ PARTIALLY FIXED

**Problem:** `spendDays` and `revenueDays` were counting 0 due to aggressive filtering.

**Root Cause:**
1. Campaign name exact matching failed
2. Geo filtering removed all rows
3. `!adset_id` filter excluded valid data

**Applied Fixes:**
1. `campaignOnlyRows` - filters by campaign but NOT geo for data sufficiency
2. Case-insensitive campaign name matching
3. Multiple fallback chains for `latestRow`

**Remaining Issue:**
When `datasetRows` is empty (no data from `/api/aibudget`), the fallback to `intelCampaignRows` may still produce empty results if campaign names don't match.

---

## 4. Database Schema Audit ✅ CORRECT

### Tables Used

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `meta_daily_metrics` | Campaign-level daily data | date, campaign_id, spend, conversions, conversion_value |
| `meta_adset_metrics` | Ad set-level daily data | date, adset_id, spend, conversions |
| `meta_ad_metrics` | Ad-level daily data | date, ad_id, spend, conversions |
| `meta_objects` | Hierarchy with status | object_type, object_id, effective_status |
| `salla_orders` | VironaX e-commerce | order_id, order_total, country_code |
| `shopify_orders` | Shawq e-commerce | order_id, subtotal, country_code |

### Indexes ✅ PROPER

```sql
idx_meta_store_date ON meta_daily_metrics(store, date)
idx_meta_objects_store_type ON meta_objects(store, object_type)
idx_meta_objects_effective_status ON meta_objects(store, effective_status)
```

---

## 5. Logical Issues

### 5.1 Lookback Period Inconsistencies ⚠️

| Location | `4weeks` | `1month` | `30d` |
|----------|----------|----------|-------|
| aiBudgetService.js | 30 days | 30 days | 30 days |
| aiBudgetDataAdapter.js | 28 days | 30 days | N/A |
| Frontend constants | N/A | N/A | 30 days |

**Recommendation:** Standardize to 28 days for `4weeks` (4 × 7 = 28).

### 5.2 Default Hill Parameters ⚠️

When data is insufficient, these defaults are used:
```javascript
{ alpha: 6000, k: 2000, gamma: 1.0, lambda: 0.5 }
```

**Issue:** These are arbitrary and not brand-specific.

**Recommendation:** Add brand-specific defaults:
```javascript
const BRAND_DEFAULTS = {
  vironax: { alpha: 8000, k: 2500, gamma: 1.0 },  // SAR, higher AOV
  shawq: { alpha: 3000, k: 1000, gamma: 1.0 }     // USD, lower AOV
};
```

### 5.3 Budget Slider Bounds ✅ CORRECT

Uses P10/P90 of recent spends with 0.5x/2x multipliers:
```javascript
const min = Math.max(200, Math.round(p10 * 0.5 / 100) * 100);
const max = Math.max(min + 500, Math.round(p90 * 2 / 100) * 100);
```

This is reasonable - allows exploring below and above historical range.

### 5.4 Structure-Aware Allocation ✅ CORRECT

**ABO:** Budget slider treated as envelope, distributed evenly.
**CBO/ASC:** Uses historical ad set spend shares for allocation inference.

```javascript
allocateBudgetThin({ structure, dailyBudget, adsets, lookbackRows }) {
  if (structure === "ABO") {
    // Even split
    const each = dailyBudget / k;
    return adsets.map(a => ({ ...a, budget: each, shareSource: "equal_abO_envelope" }));
  }
  // CBO/ASC: infer from historical shares
  const shares = MathUtils.inferAdsetShares(lookbackRows);
  // ...
}
```

---

## 6. API Contract Audit

### 6.1 GET /api/aibudget

**Response Structure:**
```json
{
  "success": true,
  "store": "vironax",
  "dateRange": { "effectiveStart": "...", "effectiveEnd": "..." },
  "hierarchy": {
    "campaigns": [{ "object_id": "...", "object_name": "..." }],
    "adsets": [...],
    "ads": [...]
  },
  "metrics": {
    "campaignDaily": [{ "date": "...", "spend": 100, "conversions": 5 }],
    "adsetDaily": [...],
    "adDaily": [...]
  },
  "totals": { "spend": 1000, "conversions": 50 },
  "metaAwareness": { "reactivationCandidates": {...} },
  "meta": { "campaignCount": 5, "hasReactivationCandidates": true }
}
```

### 6.2 GET /api/budget-intelligence

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "store": "vironax",
    "priors": { "meanCAC": 120, "meanROAS": 2.5 },
    "startPlans": [{ "country": "SA", "recommendedDaily": 150 }],
    "liveGuidance": [{ "campaignId": "...", "action": "Scale" }],
    "learningMap": { "highPriority": [], "noisy": [] }
  }
}
```

### 6.3 Field Naming Inconsistency ⚠️

| Concept | aiBudgetService | budgetIntelligenceService |
|---------|----------------|---------------------------|
| Campaign ID | `campaign_id` | `campaignId` |
| Revenue | `conversion_value` | `revenue` |
| Purchases | `conversions` | `purchases` |

**Recommendation:** Standardize to snake_case for database fields, camelCase for API responses.

---

## 7. Recommendations

### Priority 1: Critical Fixes

1. **Unify Data Contracts**
   - Both endpoints should return consistent field names
   - Frontend should not need to handle multiple mappings

2. **Fix Empty Data Fallbacks**
   - When no data matches filters, show clear diagnostic
   - Display "No data for campaign X in geo Y" instead of 0s

### Priority 2: High Impact

3. **Refactor Frontend Component**
   - Split into smaller, focused components
   - Extract math utilities to separate module
   - Create custom hooks for data fetching

4. **Add Brand-Specific Defaults**
   - Hill curve parameters per brand
   - Currency-aware recommendations

### Priority 3: Nice to Have

5. **Add Data Validation Layer**
   - Validate incoming data before processing
   - Log warnings for missing fields

6. **Improve Smart Lookback**
   - Consider data density, not just row count
   - Adaptive based on campaign age

---

## 8. Test Scenarios

### Scenario 1: Happy Path ✅
- User selects existing campaign with 30+ days of data
- All metrics display correctly
- Recommendations are reasonable

### Scenario 2: Sparse Data ⚠️
- User selects campaign with <7 days of data
- Should show "🚫 Not Enough" with specific guidance
- Currently may show 0s instead

### Scenario 3: New Campaign 🔄
- User creates planned campaign
- Should use priors from reference campaigns
- Confidence should be "Low"

### Scenario 4: Multi-Geo ⚠️
- Campaign runs in SA, AE, KW
- Data sufficiency should reflect ALL geos
- Currently may filter too aggressively

---

## 9. Conclusion

The AI Budget feature is **technically sound at its core** - the Hill curve math, Bayesian priors, and structure-aware allocation are all correctly implemented. The main issues are:

1. **Data flow fragility** - Two API sources with different formats create integration complexity
2. **Frontend complexity** - 2570-line component is hard to maintain
3. **Filtering bugs** - Already partially fixed, but edge cases remain

**Overall Assessment:** The feature provides real value for budget optimization. With the recommended fixes, it can become a reliable tool for daily budget decisions.

---

*Audit completed by analyzing: AIBudget.jsx (2570 lines), aiBudgetService.js, aiBudgetDataAdapter.js, budgetIntelligenceService.js, budgetIntelligence.js (routes), aibudget.js (routes), weeklyAggregationService.js, database.js, aiDataProvider.js, aiBudgetMigration.js, and checkAIBudgetData.js*
