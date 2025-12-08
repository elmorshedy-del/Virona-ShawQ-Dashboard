// Jewelry industry benchmarks for funnel diagnostics
export const JEWELRY_BENCHMARKS = {
  // Upper Funnel
  ctr: { poor: 1.0, average: 1.5, good: 2.5 }, // % (higher is better)
  cpc: { poor: 5, average: 3, good: 1.5 }, // SAR (lower is better)
  cpm: { poor: 60, average: 40, good: 20 }, // SAR (lower is better)
  frequency: { poor: 3.0, average: 2.0, good: 1.3 }, // (lower is better)

  // Mid Funnel
  lpvRate: { poor: 50, average: 70, good: 85 }, // % of clicks (higher is better)
  atcRate: { poor: 2, average: 4, good: 7 }, // % of LPV (higher is better)

  // Lower Funnel
  checkoutRate: { poor: 25, average: 40, good: 55 }, // % of ATC (higher is better)
  purchaseRate: { poor: 30, average: 50, good: 70 }, // % of Checkout (higher is better)
  cvr: { poor: 0.5, average: 1.0, good: 2.0 }, // % of clicks (higher is better)
  roas: { poor: 1.5, average: 2.5, good: 4.0 }, // multiplier (higher is better)
  cacPercent: { poor: 50, average: 30, good: 15 }, // % of AOV (lower is better)
};

// Alert thresholds (% change to trigger alert)
export const ALERT_THRESHOLDS = {
  ctr: { drop: 20, spike: 30 },
  cvr: { drop: 25, spike: 35 },
  roas: { drop: 25, spike: 40 },
  cpc: { increase: 30, decrease: 25 },
  cpm: { increase: 35, decrease: 30 },
  atcRate: { drop: 20, spike: 30 },
  purchaseRate: { drop: 25, spike: 35 },
  cac: { increase: 30, decrease: 25 },
  checkoutRate: { drop: 20, spike: 30 },
  lpvRate: { drop: 20, spike: 25 },
};

export const DIAGNOSTIC_RECOMMENDATIONS = {
  ctr: {
    poor: "Creative fatigue or wrong audience. Test new ad creatives with different hooks, try video content, or refine audience targeting. Check if ad frequency is too high.",
    average: "Creative is performing at industry average. A/B test new headlines, images, or CTAs to push into good territory."
  },
  cpc: {
    poor: "Paying too much per click. Review audience targeting - may be too narrow or competitive. Try broader audiences or lookalikes. Check if bidding strategy is optimal.",
    average: "CPC is acceptable but has room for improvement. Test different placements or times of day."
  },
  cpm: {
    poor: "High competition for your audience. Try different audience segments, adjust geographic targeting, or test different ad placements (Reels, Stories often cheaper).",
    average: "CPM is within normal range. Monitor for seasonal spikes."
  },
  frequency: {
    poor: "Ad fatigue detected - same people seeing your ad too many times. Refresh creatives immediately, expand audience size, or exclude recent converters.",
    average: "Approaching fatigue zone. Plan new creatives within 1-2 weeks."
  },
  lpvRate: {
    poor: "People click but don't reach landing page. Check: 1) Page load speed (should be <3s), 2) Mobile responsiveness, 3) Broken redirects, 4) Accidental clicks from ad placement.",
    average: "Some drop-off between click and landing page. Optimize page speed and ensure mobile experience is smooth."
  },
  atcRate: {
    poor: "Visitors view products but don't add to cart. Review: 1) Product images quality and angles, 2) Price perception vs competitors, 3) Missing trust signals (reviews, guarantees), 4) Unclear product details or sizing, 5) No urgency or scarcity messaging.",
    average: "ATC is at jewelry industry average. Test adding social proof, urgency timers, or better product photography."
  },
  checkoutRate: {
    poor: "Customers add to cart but don't start checkout. Check: 1) Surprise shipping costs, 2) Required account creation, 3) Cart page UX issues, 4) Missing payment options, 5) No guest checkout. Consider cart abandonment emails.",
    average: "Checkout initiation is acceptable. Test showing shipping costs earlier or adding trust badges to cart."
  },
  purchaseRate: {
    poor: "Customers start checkout but don't complete. Simplify checkout: 1) Reduce form fields, 2) Add progress indicator, 3) Show security badges, 4) Offer multiple payment methods, 5) Fix mobile checkout issues, 6) Add live chat support.",
    average: "Purchase completion is average. Consider adding buy-now-pay-later options or express checkout."
  },
  cvr: {
    poor: "Overall conversion is below jewelry benchmarks. Identify the biggest funnel drop-off (LPV->ATC->Checkout->Purchase) and fix that first. Consider if traffic quality is the issue.",
    average: "Conversion rate is normal for jewelry (high-consideration purchase). Focus on retargeting warm audiences and email flows."
  },
  roas: {
    poor: "Campaign is not profitable. Options: 1) Pause and optimize before spending more, 2) Reduce budget significantly, 3) Focus only on best-performing audiences/countries, 4) Check if product margins can support paid ads at current CAC.",
    average: "Campaign is marginally profitable. Optimize creatives and targeting to improve margins before scaling."
  },
  cac: {
    poor: "Customer acquisition cost is too high relative to order value. Either increase AOV (bundles, upsells) or reduce ad costs. May need to focus on higher-margin products only.",
    average: "CAC is acceptable but watch margins closely. Look for opportunities to increase AOV."
  }
};

export const ALERT_RECOMMENDATIONS = {
  ctr_drop: "CTR dropped significantly. Check: 1) Creative fatigue - audience seen ad too many times, 2) Audience saturation, 3) Competitor activity, 4) Seasonal factors. Refresh creatives or test new audiences.",
  ctr_spike: "CTR improved significantly! Identify what changed (new creative, audience, placement) and apply learnings to other campaigns. Consider increasing budget.",
  cvr_drop: "Conversion rate dropped significantly. Check: 1) Website/checkout issues, 2) Landing page changes, 3) Inventory problems, 4) Pricing changes, 5) Traffic quality shift. Review recent changes.",
  cvr_spike: "Conversion rate improved significantly! Analyze what drove the improvement and replicate across other campaigns. Good time to scale.",
  roas_drop: "ROAS dropped significantly. Pause or reduce budget until identified. Check: 1) CPM/CPC increases, 2) CVR drops, 3) AOV changes. Don't scale until fixed.",
  roas_spike: "ROAS improved significantly! Campaign is performing well. Consider: 1) Increasing budget 20-30%, 2) Testing similar audiences, 3) Applying learnings elsewhere.",
  cpc_increase: "CPC increased significantly. Check: 1) Audience competition increased, 2) Quality score dropped, 3) Bidding strategy issues. Test broader audiences or new placements.",
  cpc_decrease: "CPC decreased! Good efficiency improvement. Monitor conversion rates to ensure quality maintained.",
  cpm_increase: "CPM increased significantly. Higher competition or seasonal factors. Consider: 1) Testing new placements, 2) Adjusting audience targeting, 3) Waiting for competition to decrease.",
  cpm_decrease: "CPM decreased! More efficient reach. Good time to scale impressions if performance holds.",
  atcRate_drop: "Add-to-cart rate dropped. Check: 1) Product page changes, 2) Pricing issues, 3) Stock availability, 4) Traffic quality shift. Review product page experience.",
  atcRate_spike: "Add-to-cart rate improved! Product page is resonating. Apply successful elements to other products.",
  purchaseRate_drop: "Purchase completion rate dropped. Check checkout flow immediately: 1) Payment gateway issues, 2) Shipping cost surprises, 3) Form errors, 4) Mobile checkout problems.",
  purchaseRate_spike: "Purchase completion improved! Checkout optimizations working. Monitor and maintain.",
  cac_increase: "Customer acquisition cost increased. Review: 1) Ad costs increased, 2) Conversion decreased, 3) Both. May need to pause scaling until efficient again.",
  cac_decrease: "CAC improved! More efficient customer acquisition. Good indicator to scale if sustained.",
  checkoutRate_drop: "Checkout rate dropped. Customers adding to cart but not proceeding. Check cart page UX and shipping cost visibility.",
  checkoutRate_spike: "Checkout rate improved! Cart experience is working well.",
  lpvRate_drop: "Landing page view rate dropped. Page load issues or wrong traffic. Check page speed and ad targeting.",
  lpvRate_spike: "Landing page view rate improved! Good traffic quality and page performance."
};
