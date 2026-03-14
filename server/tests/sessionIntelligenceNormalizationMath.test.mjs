import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMoneyLeakEstimate,
  buildNormalizedFunnelMetrics,
  buildNormalizedProductMetrics,
  buildNormalizedSegmentMetrics,
  getDownstreamPurchaseRateFromStages,
  getAnchoredJourneyProduct,
  getJourneySegment,
  hasJourneyReachedStage,
  rankMoneyLeakCandidates,
  shrinkBinomialRate
} from '../services/sessionIntelligenceNormalizationMath.js';

function makeJourney(overrides = {}) {
  return {
    product_view_count: 0,
    cart_entered_at: null,
    checkout_started_at: null,
    payment_info_submitted_at: null,
    purchase_at: null,
    purchased_in_session: false,
    first_product_id: null,
    first_product_label: null,
    last_product_before_cart_id: null,
    last_product_before_cart_label: null,
    last_product_id: null,
    last_product_label: null,
    last_checkout_step: null,
    last_meaningful_event_name: null,
    sequence: [],
    event_breakdown: {},
    ...overrides
  };
}

test('hasJourneyReachedStage derives funnel stages from stitched journey fields', () => {
  const journey = makeJourney({
    product_view_count: 2,
    cart_entered_at: '2026-03-11 12:01:00',
    checkout_started_at: '2026-03-11 12:02:00',
    payment_info_submitted_at: '2026-03-11 12:03:00',
    purchase_at: '2026-03-11 12:04:00',
    purchased_in_session: true,
    sequence: ['home', 'product', 'cart', 'checkout_contact', 'checkout_payment', 'purchase'],
    event_breakdown: {
      add_to_cart_clicked: 1,
      product_added_to_cart: 1,
      payment_info_submitted: 1,
      checkout_completed: 1
    }
  });

  assert.equal(hasJourneyReachedStage(journey, 'landing'), true);
  assert.equal(hasJourneyReachedStage(journey, 'product'), true);
  assert.equal(hasJourneyReachedStage(journey, 'atc'), true);
  assert.equal(hasJourneyReachedStage(journey, 'cart'), true);
  assert.equal(hasJourneyReachedStage(journey, 'checkout'), true);
  assert.equal(hasJourneyReachedStage(journey, 'payment'), true);
  assert.equal(hasJourneyReachedStage(journey, 'purchase'), true);
});

test('shrinkBinomialRate shrinks toward the prior rate for small samples', () => {
  const shrunk = shrinkBinomialRate({
    successes: 1,
    trials: 2,
    priorRate: 0.2,
    priorStrength: 20
  });

  assert.ok(shrunk > 0.2);
  assert.ok(shrunk < 0.5);
});

test('buildNormalizedFunnelMetrics marks weak transitions against a stronger baseline', () => {
  const currentJourneys = Array.from({ length: 60 }, (_, index) => {
    if (index < 15) {
      return makeJourney({
        product_view_count: 1,
        sequence: ['product', 'cart'],
        event_breakdown: { add_to_cart_clicked: 1, product_added_to_cart: 1 },
        cart_entered_at: '2026-03-11 12:00:00'
      });
    }
    return makeJourney({
      product_view_count: 1,
      sequence: ['product']
    });
  });

  const baselineJourneys = Array.from({ length: 60 }, (_, index) => {
    if (index < 30) {
      return makeJourney({
        product_view_count: 1,
        sequence: ['product', 'cart'],
        event_breakdown: { add_to_cart_clicked: 1, product_added_to_cart: 1 },
        cart_entered_at: '2026-02-20 12:00:00'
      });
    }
    return makeJourney({
      product_view_count: 1,
      sequence: ['product']
    });
  });

  const metrics = buildNormalizedFunnelMetrics({ currentJourneys, baselineJourneys });
  const productToAtc = metrics.transitions.find((transition) => transition.fromStage === 'product' && transition.toStage === 'atc');

  assert.ok(productToAtc);
  assert.equal(productToAtc.comparison.status, 'weaker_than_usual');
  assert.ok(productToAtc.comparison.missedAdvancedJourneys > 10);
  assert.ok(productToAtc.current.rate < productToAtc.baseline.rate);
});

test('buildNormalizedFunnelMetrics suppresses conclusions when current sample is too small', () => {
  const currentJourneys = Array.from({ length: 10 }, () => makeJourney({ product_view_count: 1, sequence: ['product'] }));
  const baselineJourneys = Array.from({ length: 100 }, (_, index) => makeJourney({
    product_view_count: 1,
    sequence: index < 50 ? ['product', 'cart'] : ['product'],
    event_breakdown: index < 50 ? { add_to_cart_clicked: 1, product_added_to_cart: 1 } : {}
  }));

  const metrics = buildNormalizedFunnelMetrics({ currentJourneys, baselineJourneys });
  const productToAtc = metrics.transitions.find((transition) => transition.fromStage === 'product' && transition.toStage === 'atc');

  assert.ok(productToAtc);
  assert.equal(productToAtc.comparison.status, 'limited_data');
});

test('getAnchoredJourneyProduct prefers the last product before cart', () => {
  const journey = makeJourney({
    first_product_id: 'prod-first',
    first_product_label: 'First Product',
    last_product_id: 'prod-last',
    last_product_label: 'Last Product',
    last_product_before_cart_id: 'prod-cart',
    last_product_before_cart_label: 'Cart Product'
  });

  const anchored = getAnchoredJourneyProduct(journey);

  assert.deepEqual(anchored, {
    productKey: 'id:prod-cart',
    productId: 'prod-cart',
    productLabel: 'Cart Product',
    attributionSource: 'last_product_before_cart'
  });
});

test('buildNormalizedProductMetrics flags products that move into cart less often than usual', () => {
  const makeWeakProductJourney = (advanced) => makeJourney({
    first_product_id: 'prod-hoodie',
    first_product_label: 'Hoodie',
    last_product_id: 'prod-hoodie',
    last_product_label: 'Hoodie',
    last_product_before_cart_id: advanced ? 'prod-hoodie' : null,
    last_product_before_cart_label: advanced ? 'Hoodie' : null,
    product_view_count: 1,
    sequence: advanced ? ['product', 'cart'] : ['product'],
    event_breakdown: advanced ? { add_to_cart_clicked: 1, product_added_to_cart: 1 } : {},
    cart_entered_at: advanced ? '2026-03-11 12:00:00' : null
  });

  const currentJourneys = [
    ...Array.from({ length: 40 }, (_, index) => makeWeakProductJourney(index < 8)),
    ...Array.from({ length: 25 }, (_, index) => makeJourney({
      first_product_id: 'prod-jeans',
      first_product_label: 'Jeans',
      last_product_id: 'prod-jeans',
      last_product_label: 'Jeans',
      last_product_before_cart_id: index < 10 ? 'prod-jeans' : null,
      last_product_before_cart_label: index < 10 ? 'Jeans' : null,
      product_view_count: 1,
      sequence: index < 10 ? ['product', 'cart'] : ['product'],
      event_breakdown: index < 10 ? { add_to_cart_clicked: 1, product_added_to_cart: 1 } : {},
      cart_entered_at: index < 10 ? '2026-03-11 12:05:00' : null
    }))
  ];

  const baselineJourneys = [
    ...Array.from({ length: 60 }, (_, index) => makeWeakProductJourney(index < 24)),
    ...Array.from({ length: 30 }, (_, index) => makeJourney({
      first_product_id: 'prod-jeans',
      first_product_label: 'Jeans',
      last_product_id: 'prod-jeans',
      last_product_label: 'Jeans',
      last_product_before_cart_id: index < 12 ? 'prod-jeans' : null,
      last_product_before_cart_label: index < 12 ? 'Jeans' : null,
      product_view_count: 1,
      sequence: index < 12 ? ['product', 'cart'] : ['product'],
      event_breakdown: index < 12 ? { add_to_cart_clicked: 1, product_added_to_cart: 1 } : {},
      cart_entered_at: index < 12 ? '2026-02-20 12:05:00' : null
    }))
  ];

  const metrics = buildNormalizedProductMetrics({ currentJourneys, baselineJourneys });
  const hoodie = metrics.products.find((product) => product.productId === 'prod-hoodie');

  assert.ok(hoodie);
  assert.equal(metrics.products[0].productId, 'prod-hoodie');
  assert.equal(hoodie.comparison.primaryTransition.fromStage, 'product');
  assert.equal(hoodie.comparison.primaryTransition.toStage, 'atc');
  assert.equal(hoodie.comparison.primaryTransition.comparison.status, 'weaker_than_usual');
  assert.ok(hoodie.comparison.primaryTransition.comparison.missedAdvancedJourneys > 5);
});


test('getJourneySegment normalizes device, source, country, and campaign labels for merchant-safe segments', () => {
  const journey = makeJourney({
    entry_device_os: 'ios',
    entry_device_type: 'mobile',
    entry_source: 'ig'
  });

  assert.deepEqual(getJourneySegment(journey, 'device'), {
    segmentKey: 'device:ios',
    segmentLabel: 'iOS',
    dimension: 'device'
  });
  assert.deepEqual(getJourneySegment(journey, 'source'), {
    segmentKey: 'source:instagram',
    segmentLabel: 'Instagram',
    dimension: 'source'
  });
  assert.deepEqual(getJourneySegment(makeJourney({ entry_source: '' }), 'source'), {
    segmentKey: 'source:direct',
    segmentLabel: 'Direct',
    dimension: 'source'
  });
  assert.deepEqual(getJourneySegment(makeJourney({ entry_country_code: 'gb' }), 'country'), {
    segmentKey: 'country:united_kingdom',
    segmentLabel: 'United Kingdom',
    dimension: 'country'
  });
  assert.deepEqual(getJourneySegment(makeJourney({ entry_campaign: '' }), 'campaign'), {
    segmentKey: 'campaign:no_campaign_tag',
    segmentLabel: 'No campaign tag',
    dimension: 'campaign'
  });
});

test('buildNormalizedSegmentMetrics flags device cohorts that leak earlier than usual', () => {
  const makeDeviceJourney = ({ deviceOs, advanced }) => makeJourney({
    entry_device_os: deviceOs,
    entry_device_type: 'mobile',
    product_view_count: 1,
    sequence: advanced ? ['product', 'cart'] : ['product'],
    event_breakdown: advanced ? { add_to_cart_clicked: 1, product_added_to_cart: 1 } : {},
    cart_entered_at: advanced ? '2026-03-11 12:00:00' : null
  });

  const currentJourneys = [
    ...Array.from({ length: 40 }, (_, index) => makeDeviceJourney({ deviceOs: 'ios', advanced: index < 8 })),
    ...Array.from({ length: 30 }, (_, index) => makeDeviceJourney({ deviceOs: 'android', advanced: index < 12 }))
  ];

  const baselineJourneys = [
    ...Array.from({ length: 60 }, (_, index) => makeDeviceJourney({ deviceOs: 'ios', advanced: index < 24 })),
    ...Array.from({ length: 40 }, (_, index) => makeDeviceJourney({ deviceOs: 'android', advanced: index < 16 }))
  ];

  const metrics = buildNormalizedSegmentMetrics({
    currentJourneys,
    baselineJourneys,
    dimension: 'device'
  });
  const ios = metrics.segments.find((segment) => segment.segmentKey === 'device:ios');

  assert.ok(ios);
  assert.equal(metrics.segments[0].segmentKey, 'device:ios');
  assert.equal(ios.comparison.primaryTransition.fromStage, 'product');
  assert.equal(ios.comparison.primaryTransition.toStage, 'atc');
  assert.equal(ios.comparison.primaryTransition.comparison.status, 'weaker_than_usual');
  assert.ok(ios.comparison.primaryTransition.comparison.missedAdvancedJourneys > 5);
});


test('buildNormalizedSegmentMetrics flags campaign cohorts that convert less often than usual', () => {
  const makeCampaignJourney = ({ campaign, purchased }) => makeJourney({
    entry_campaign: campaign,
    product_view_count: 1,
    sequence: purchased
      ? ['product', 'cart', 'checkout_contact', 'checkout_payment', 'purchase']
      : ['product', 'cart', 'checkout_contact', 'checkout_payment'],
    event_breakdown: purchased
      ? { add_to_cart_clicked: 1, product_added_to_cart: 1, payment_info_submitted: 1, checkout_completed: 1 }
      : { add_to_cart_clicked: 1, product_added_to_cart: 1, payment_info_submitted: 1 },
    cart_entered_at: '2026-03-11 12:00:00',
    checkout_started_at: '2026-03-11 12:02:00',
    payment_info_submitted_at: '2026-03-11 12:04:00',
    purchase_at: purchased ? '2026-03-11 12:05:00' : null,
    purchased_in_session: purchased,
    last_meaningful_event_name: purchased ? 'checkout_completed' : 'payment_info_submitted'
  });

  const currentJourneys = [
    ...Array.from({ length: 30 }, (_, index) => makeCampaignJourney({ campaign: 'Spring Prospecting', purchased: index < 2 })),
    ...Array.from({ length: 20 }, (_, index) => makeCampaignJourney({ campaign: 'Retargeting', purchased: index < 4 }))
  ];

  const baselineJourneys = [
    ...Array.from({ length: 45 }, (_, index) => makeCampaignJourney({ campaign: 'Spring Prospecting', purchased: index < 9 })),
    ...Array.from({ length: 30 }, (_, index) => makeCampaignJourney({ campaign: 'Retargeting', purchased: index < 6 }))
  ];

  const metrics = buildNormalizedSegmentMetrics({
    currentJourneys,
    baselineJourneys,
    dimension: 'campaign'
  });
  const springProspecting = metrics.segments.find((segment) => segment.segmentKey === 'campaign:spring_prospecting');

  assert.ok(springProspecting);
  assert.equal(metrics.segments[0].segmentKey, 'campaign:spring_prospecting');
  assert.equal(springProspecting.comparison.primaryTransition.fromStage, 'payment');
  assert.equal(springProspecting.comparison.primaryTransition.toStage, 'purchase');
  assert.equal(springProspecting.comparison.primaryTransition.comparison.status, 'weaker_than_usual');
  assert.ok(springProspecting.comparison.primaryTransition.comparison.missedAdvancedJourneys > 2);
});

test('getDownstreamPurchaseRateFromStages reads purchase reach from stage counts', () => {
  const stages = [
    { stageKey: 'product', reachedJourneys: 40, baselineReachedJourneys: 60 },
    { stageKey: 'cart', reachedJourneys: 20, baselineReachedJourneys: 30 },
    { stageKey: 'checkout', reachedJourneys: 10, baselineReachedJourneys: 18 },
    { stageKey: 'purchase', reachedJourneys: 4, baselineReachedJourneys: 9 }
  ];

  assert.equal(getDownstreamPurchaseRateFromStages(stages, 'checkout'), 0.4);
  assert.equal(getDownstreamPurchaseRateFromStages(stages, 'checkout', 'baselineReachedJourneys'), 0.5);
});

test('buildMoneyLeakEstimate turns missed progression into lost purchases and revenue', () => {
  const transition = {
    fromStage: 'cart',
    toStage: 'checkout',
    comparison: {
      missedAdvancedJourneys: 8
    }
  };
  const stages = [
    { stageKey: 'cart', reachedJourneys: 20, baselineReachedJourneys: 30 },
    { stageKey: 'checkout', reachedJourneys: 10, baselineReachedJourneys: 18 },
    { stageKey: 'purchase', reachedJourneys: 4, baselineReachedJourneys: 9 }
  ];

  const estimate = buildMoneyLeakEstimate({
    transition,
    stages,
    referenceAov: 100
  });

  assert.ok(estimate);
  assert.equal(estimate.downstreamPurchaseRate, 0.5);
  assert.equal(estimate.estimatedLostPurchases, 4);
  assert.equal(estimate.estimatedLostRevenue, 400);
});

test('rankMoneyLeakCandidates prefers higher revenue risk over raw missed journeys', () => {
  const ranked = rankMoneyLeakCandidates([
    {
      label: 'Product to cart',
      moneyLeak: {
        missedAdvancedJourneys: 12,
        estimatedLostPurchases: 1.2,
        estimatedLostRevenue: 72,
        rankingScore: 72
      }
    },
    {
      label: 'Checkout to purchase',
      moneyLeak: {
        missedAdvancedJourneys: 4,
        estimatedLostPurchases: 2,
        estimatedLostRevenue: 240,
        rankingScore: 240
      }
    }
  ]);

  assert.equal(ranked[0].label, 'Checkout to purchase');
  assert.equal(ranked[1].label, 'Product to cart');
});
