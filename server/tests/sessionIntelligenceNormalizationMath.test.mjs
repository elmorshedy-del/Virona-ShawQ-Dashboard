import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNormalizedFunnelMetrics,
  hasJourneyReachedStage,
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
