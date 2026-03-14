import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionIntelligenceNormalizedBrief } from '../services/sessionIntelligenceNormalizationBriefText.js';

function makeFunnelReport({ purchases = 0 } = {}) {
  return {
    data: {
      stages: [
        { stageKey: 'landing', reachedJourneys: 120 },
        { stageKey: 'purchase', reachedJourneys: purchases }
      ]
    }
  };
}

function makeMoneyLeakReport(overrides = {}) {
  return {
    data: {
      store: 'shawq',
      currentPeriod: {
        label: '2026-03-11',
        totalJourneys: 120
      },
      topLeaks: [],
      productLeaks: [],
      segmentLeaks: {
        device: [],
        source: [],
        country: [],
        campaign: []
      },
      ...overrides
    }
  };
}

test('buildSessionIntelligenceNormalizedBrief writes a readable owner summary from normalized leaks', () => {
  const brief = buildSessionIntelligenceNormalizedBrief({
    store: 'shawq',
    date: '2026-03-11',
    funnelReport: makeFunnelReport({ purchases: 8 }),
    moneyLeakReport: makeMoneyLeakReport({
      topLeaks: [
        {
          scope: 'funnel',
          label: 'Cart to Checkout',
          transition: { label: 'Cart to Checkout' },
          moneyLeak: { estimatedLostPurchases: 2.4 }
        }
      ],
      productLeaks: [
        {
          scope: 'product',
          label: 'Hoodie Unisex',
          productKey: 'id:prod-hoodie',
          transition: { label: 'Product to Add to cart' },
          moneyLeak: { estimatedLostPurchases: 1.3 }
        }
      ],
      segmentLeaks: {
        device: [
          {
            scope: 'segment',
            dimension: 'device',
            label: 'iOS',
            transition: { label: 'Cart to Checkout' },
            moneyLeak: { estimatedLostPurchases: 1.1 }
          }
        ],
        source: [],
        country: [],
        campaign: []
      }
    })
  });

  assert.match(brief, /On 2026-03-11, Shawq had 120 stitched shopper journeys and 8 purchases\./);
  assert.match(brief, /The clearest money leak was Cart to Checkout/);
  assert.match(brief, /Hoodie Unisex also stood out/);
  assert.match(brief, /iOS shoppers were also weaker than usual/);
});

test('buildSessionIntelligenceNormalizedBrief falls back cleanly when normalized leaks are quiet', () => {
  const brief = buildSessionIntelligenceNormalizedBrief({
    store: 'shawq',
    date: '2026-03-11',
    funnelReport: makeFunnelReport({ purchases: 3 }),
    moneyLeakReport: makeMoneyLeakReport()
  });

  assert.match(brief, /The main funnel steps stayed within their usual range/);
  assert.match(brief, /Keep watching for more traffic before forcing a fix/);
});
