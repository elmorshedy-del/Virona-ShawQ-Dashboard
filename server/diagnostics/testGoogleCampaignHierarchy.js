import assert from 'node:assert/strict';
import http from 'node:http';

function createMockServer() {
  return http.createServer((req, res) => {
    if (req.url === '/token' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mock-access-token', expires_in: 3600 }));
      return;
    }

    if (req.url === '/googleads/v18/customers/1234567890/googleAds:searchStream' && req.method === 'POST') {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const query = String(payload.query || '');

        if (query.includes('geo_target_constant.resource_name')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                results: [
                  {
                    geoTargetConstant: {
                      resourceName: 'geoTargetConstants/2840',
                      countryCode: 'US'
                    }
                  }
                ]
              }
            ])
          );
          return;
        }

        if (query.includes('segments.geo_target_country')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                results: [
                  {
                    campaign: {
                      id: '101',
                      name: 'Google Search US',
                      status: 'ENABLED'
                    },
                    segments: {
                      geoTargetCountry: 'geoTargetConstants/2840'
                    },
                    metrics: {
                      costMicros: '24000000',
                      impressions: '4200',
                      clicks: '180',
                      conversions: '12',
                      conversionsValue: '960'
                    }
                  }
                ]
              }
            ])
          );
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              results: [
                {
                  campaign: {
                    id: '101',
                    name: 'Google Search US',
                    status: 'ENABLED'
                  },
                  metrics: {
                    costMicros: '55000000',
                    impressions: '10000',
                    clicks: '500',
                    conversions: '25',
                    conversionsValue: '2100'
                  }
                }
              ]
            }
          ])
        );
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path: req.url }));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function run() {
  const server = createMockServer();
  const port = await listen(server);

  try {
    process.env.GOOGLE_OAUTH_TOKEN_URL = `http://127.0.0.1:${port}/token`;
    process.env.GOOGLE_ADS_API_BASE_URL = `http://127.0.0.1:${port}/googleads/v18`;
    process.env.TESTSTORE_GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
    process.env.TESTSTORE_GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
    process.env.TESTSTORE_GOOGLE_ADS_REFRESH_TOKEN = 'refresh-token';
    process.env.TESTSTORE_GOOGLE_ADS_CLIENT_ID = 'client-id';
    process.env.TESTSTORE_GOOGLE_ADS_CLIENT_SECRET = 'client-secret';

    const { fetchGoogleCampaignHierarchy } = await import('../services/googleAdsService.js');

    const noBreakdown = await fetchGoogleCampaignHierarchy({
      store: 'teststore',
      startDate: '2026-02-01',
      endDate: '2026-02-07',
      breakdown: 'none',
      includeInactive: false
    });

    assert.equal(noBreakdown.notice, '');
    assert.equal(noBreakdown.data.length, 1);
    assert.equal(noBreakdown.data[0].campaign_id, 'google:101');
    assert.equal(noBreakdown.data[0].spend, 55);
    assert.equal(noBreakdown.data[0].inline_link_clicks, 500);
    assert.equal(noBreakdown.data[0].cost_per_inline_link_click, 0.11);

    const countryBreakdown = await fetchGoogleCampaignHierarchy({
      store: 'teststore',
      startDate: '2026-02-01',
      endDate: '2026-02-07',
      breakdown: 'country',
      includeInactive: false
    });

    assert.equal(countryBreakdown.notice, '');
    assert.equal(countryBreakdown.data.length, 1);
    assert.equal(countryBreakdown.data[0].campaign_id, 'google:101');
    assert.equal(countryBreakdown.data[0].country_breakdowns.length, 1);
    assert.equal(countryBreakdown.data[0].country_breakdowns[0].country, 'US');
    assert.equal(countryBreakdown.data[0].country_breakdowns[0].spend, 24);

    const nonGoogleCampaignFilter = await fetchGoogleCampaignHierarchy({
      store: 'teststore',
      startDate: '2026-02-01',
      endDate: '2026-02-07',
      breakdown: 'none',
      campaignId: '123456789'
    });

    assert.equal(nonGoogleCampaignFilter.data.length, 0);

    console.log('PASS testGoogleCampaignHierarchy');
  } finally {
    await close(server);
  }
}

run().catch((error) => {
  console.error('FAIL testGoogleCampaignHierarchy');
  console.error(error);
  process.exitCode = 1;
});
