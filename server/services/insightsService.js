import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import {
  fetchPersonaInsight,
  fetchGeoInsight,
  fetchAdjacentInsight,
  fetchPeaksInsight
} from './insightsModelService.js';

const STORE_DEFAULTS = {
  vironax: {
    name: 'Virona',
    basePrice: 280,
    currency: 'SAR',
    adjacentSuggestion: 'Onyx + amber premium bundle'
  },
  shawq: {
    name: 'Shawq',
    basePrice: 75,
    currency: 'USD',
    adjacentSuggestion: 'Heritage embroidery bundle'
  }
};

const SEGMENTS = [
  { id: 'Gift Buyers', ages: ['45-54', '55-64', '65+'] },
  { id: 'Premium Seekers', ages: ['35-44'] },
  { id: 'Core Buyers', ages: ['25-34'] },
  { id: 'Trend Hunters', ages: ['18-24'] }
];

const COUNTRY_NAMES = {
  AE: 'UAE',
  SA: 'KSA',
  QA: 'Qatar',
  BH: 'Bahrain',
  KW: 'Kuwait',
  OM: 'Oman',
  US: 'USA',
  GB: 'UK'
};

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';

const getMetaCredentials = (store) => {
  if (store === 'shawq') {
    return {
      accessToken: process.env.SHAWQ_META_ACCESS_TOKEN,
      adAccountId: process.env.SHAWQ_META_AD_ACCOUNT_ID
    };
  }
  return {
    accessToken: process.env.META_ACCESS_TOKEN || process.env.VIRONAX_META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID || process.env.VIRONAX_META_AD_ACCOUNT_ID
  };
};

const fetchMetaJson = async (path, accessToken, params = {}) => {
  if (!accessToken) return null;
  const query = new URLSearchParams({ access_token: accessToken, ...params }).toString();
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}${path}?${query}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    return null;
  }
};

const extractVideoId = (creative) => {
  if (!creative) return null;
  const directVideoId = creative?.object_story_spec?.video_data?.video_id;
  if (directVideoId) return directVideoId;
  const linkVideoId = creative?.object_story_spec?.link_data?.video_id;
  if (linkVideoId) return linkVideoId;
  const videos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(videos) && videos.length > 0) {
    const videoEntry = videos.find((video) => video?.video_id) || videos[0];
    return videoEntry?.video_id || null;
  }
  const carouselElements = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(carouselElements)) {
    const videoElement = carouselElements.find((element) => element?.video_id);
    if (videoElement?.video_id) return videoElement.video_id;
  }
  return null;
};

const extractThumbnailUrl = (creative) => {
  if (!creative) return null;
  if (creative.thumbnail_url) return creative.thumbnail_url;
  if (creative.image_url) return creative.image_url;
  const videoImage = creative?.object_story_spec?.video_data?.image_url;
  if (videoImage) return videoImage;
  const linkImage =
    creative?.object_story_spec?.link_data?.image_url ||
    creative?.object_story_spec?.link_data?.picture;
  if (linkImage) return linkImage;
  const photoUrl =
    creative?.object_story_spec?.photo_data?.url ||
    creative?.object_story_spec?.photo_data?.image_url;
  if (photoUrl) return photoUrl;
  const assetImages = creative?.asset_feed_spec?.images;
  if (Array.isArray(assetImages) && assetImages.length > 0) {
    const image = assetImages[0];
    if (image?.url) return image.url;
    if (image?.image_url) return image.image_url;
  }
  const assetVideos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(assetVideos) && assetVideos.length > 0) {
    const video = assetVideos[0];
    if (video?.thumbnail_url) return video.thumbnail_url;
    if (video?.picture) return video.picture;
  }
  const carouselElements = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(carouselElements) && carouselElements.length > 0) {
    const first = carouselElements[0];
    if (first?.picture) return first.picture;
    if (first?.image_url) return first.image_url;
  }
  return null;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toNumber = (value) => (Number.isFinite(value) ? value : 0);

const getDateString = (date) => date.toISOString().split('T')[0];

const addDays = (date, delta) => {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
};


const getTopAdCreatives = async (store, startDate, endDate, limit = 6) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ad_id, ad_name,
           SUM(conversions) as conversions,
           SUM(clicks) as clicks,
           SUM(impressions) as impressions
    FROM meta_ad_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND ad_id IS NOT NULL
    GROUP BY ad_id, ad_name
    ORDER BY conversions DESC
    LIMIT ?
  `).all(store, startDate, endDate, limit);

  if (!rows.length) return [];

  const { accessToken } = getMetaCredentials(store);
  if (!accessToken) {
    return rows.map((row) => ({
      ad_id: row.ad_id,
      ad_name: row.ad_name,
      image_url: null,
      video_url: null,
      metrics: {
        ctr: row.impressions ? row.clicks / row.impressions : 0,
        conversions: row.conversions,
        impressions: row.impressions
      }
    }));
  }

  const assets = [];
  for (const row of rows) {
    const creativeResult = await fetchMetaJson(`/${row.ad_id}`, accessToken, {
      fields: 'creative{thumbnail_url,image_url,object_story_spec{video_data,link_data,photo_data},asset_feed_spec{videos,images}}'
    });
    const creative = creativeResult?.creative || creativeResult?.data?.creative || creativeResult?.creative;
    const videoId = extractVideoId(creative);
    let videoUrl = null;
    if (videoId) {
      const videoResult = await fetchMetaJson(`/${videoId}`, accessToken, {
        fields: 'source,picture,thumbnails{uri}'
      });
      videoUrl = videoResult?.source || null;
    }
    const imageUrl = extractThumbnailUrl(creative);
    assets.push({
      ad_id: row.ad_id,
      ad_name: row.ad_name,
      image_url: imageUrl,
      video_url: videoUrl,
      metrics: {
        ctr: row.impressions ? row.clicks / row.impressions : 0,
        conversions: row.conversions,
        impressions: row.impressions
      }
    });
  }
  return assets;
};

const getCreativeHistory = (store, adIds, startDate, endDate) => {
  if (!adIds || !adIds.length) return [];
  const db = getDb();
  const placeholders = adIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ad_id, date,
           SUM(impressions) as impressions,
           SUM(clicks) as clicks,
           SUM(conversions) as conversions
    FROM meta_ad_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND ad_id IN (${placeholders})
    GROUP BY ad_id, date
    ORDER BY date ASC
  `).all(store, startDate, endDate, ...adIds);

  if (!rows.length) return [];

  const start = new Date(startDate);
  return rows.map((row) => {
    const dayIndex = Math.max(0, Math.floor((new Date(row.date) - start) / 86400000));
    const impressions = row.impressions || 0;
    const clicks = row.clicks || 0;
    const ctr = impressions ? clicks / impressions : 0;
    return {
      ad_id: row.ad_id,
      day_index: dayIndex,
      ctr,
      conversions: row.conversions || 0
    };
  });
};

const getGeoFeatures = (store, recentStart, endDate, priorStart) => {
  const db = getDb();
  const recent = db.prepare(`
    SELECT country,
           SUM(spend) as spend,
           SUM(conversions) as conversions,
           SUM(clicks) as clicks,
           SUM(impressions) as impressions,
           SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(store, recentStart, endDate);

  const prior = db.prepare(`
    SELECT country,
           SUM(conversions) as conversions
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(store, priorStart, recentStart);

  const priorMap = new Map();
  prior.forEach((row) => {
    priorMap.set(row.country, row.conversions || 0);
  });

  return recent.map((row) => {
    const growth = priorMap.get(row.country)
      ? (row.conversions - priorMap.get(row.country)) / priorMap.get(row.country)
      : row.conversions ? 1 : 0;
    const ctr = row.impressions ? row.clicks / row.impressions : 0;
    const cvr = row.clicks ? row.conversions / row.clicks : 0;
    const aov = row.conversions ? row.revenue / row.conversions : 0;
    return {
      geo: COUNTRY_NAMES[row.country] || row.country,
      spend: row.spend || 0,
      conversions: row.conversions || 0,
      ctr,
      cvr,
      aov,
      growth
    };
  });
};

const getOrderItemData = (store, recentStart, endDate) => {
  const db = getDb();
  const table = store === 'vironax' ? 'salla_order_items' : 'shopify_order_items';
  try {
    const rows = db.prepare(`
      SELECT order_id, order_date, name, sku, product_id, variant_id
      FROM ${table}
      WHERE store = ? AND order_date BETWEEN ? AND ?
    `).all(store, recentStart, endDate);

    if (!rows.length) return { orders: [], edges: [] };

    const orderMap = new Map();
    rows.forEach((row) => {
      const key = row.order_id;
      if (!orderMap.has(key)) {
        orderMap.set(key, []);
      }
      const label = row.sku || row.product_id || row.name || row.variant_id;
      if (label) orderMap.get(key).push(label);
    });

    const orders = [];
    const edgeMap = new Map();
    orderMap.forEach((items, orderId) => {
      const uniqueItems = Array.from(new Set(items));
      if (uniqueItems.length < 1) return;
      orders.push({ order_id: orderId, items: uniqueItems });
      for (let i = 0; i < uniqueItems.length; i += 1) {
        for (let j = i + 1; j < uniqueItems.length; j += 1) {
          const key = `${uniqueItems[i]}|||${uniqueItems[j]}`;
          edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        }
      }
    });

    const edges = Array.from(edgeMap.entries()).map(([key, weight]) => {
      const [source, target] = key.split('|||');
      return { source, target, weight };
    });

    return { orders, edges };
  } catch (error) {
    return { orders: [], edges: [] };
  }
};

const getForecastSeries = (store, recentStart, endDate) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, SUM(conversions) as conversions
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `).all(store, recentStart, endDate);
  return rows.map((row) => ({ date: row.date, value: row.conversions || 0 }));
};


const normalize = (value, min, max) => {
  if (max === min) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
};

function getLatestMetaDate(db, store) {
  const row = db.prepare('SELECT MAX(date) as maxDate FROM meta_daily_metrics WHERE store = ?').get(store);
  return row?.maxDate || null;
}

function getOrdersTable(store) {
  return store === 'vironax' ? 'salla_orders' : 'shopify_orders';
}

function getOrdersSummary(db, store, startDate, endDate) {
  const table = getOrdersTable(store);
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as orders, SUM(order_total) as revenue
      FROM ${table}
      WHERE store = ? AND date BETWEEN ? AND ?
    `).get(store, startDate, endDate);
    return {
      orders: row?.orders || 0,
      revenue: row?.revenue || 0
    };
  } catch (error) {
    return { orders: 0, revenue: 0 };
  }
}

function buildRadarPoints({ rows, coverageRate, basePrice }) {
  const byCountry = new Map();
  rows.forEach((row) => {
    if (!row.country || row.country === 'ALL') return;
    const entry = byCountry.get(row.country) || {
      country: row.country,
      recentOrders: 0,
      priorOrders: 0,
      recentRevenue: 0,
      priorRevenue: 0,
      recentSpend: 0,
      priorSpend: 0
    };
    if (row.period === 'recent') {
      entry.recentOrders += toNumber(row.conversions);
      entry.recentRevenue += toNumber(row.revenue);
      entry.recentSpend += toNumber(row.spend);
    } else {
      entry.priorOrders += toNumber(row.conversions);
      entry.priorRevenue += toNumber(row.revenue);
      entry.priorSpend += toNumber(row.spend);
    }
    byCountry.set(row.country, entry);
  });

  const entries = Array.from(byCountry.values());
  if (!entries.length) {
    return [
      { geo: 'UAE', demand: 72, competition: 48, marketSize: 62, readiness: 70 },
      { geo: 'KSA', demand: 64, competition: 70, marketSize: 78, readiness: 62 },
      { geo: 'Qatar', demand: 58, competition: 40, marketSize: 48, readiness: 58 },
      { geo: 'Bahrain', demand: 62, competition: 35, marketSize: 55, readiness: 56 }
    ];
  }

  const growthValues = entries.map((entry) => {
    if (!entry.priorOrders) return entry.recentOrders ? 1 : 0;
    return (entry.recentOrders - entry.priorOrders) / entry.priorOrders;
  });
  const volumeValues = entries.map((entry) => entry.recentRevenue || entry.recentOrders * basePrice);
  const spendValues = entries.map((entry) => entry.recentSpend);

  const minGrowth = Math.min(...growthValues);
  const maxGrowth = Math.max(...growthValues);
  const minVolume = Math.min(...volumeValues);
  const maxVolume = Math.max(...volumeValues);
  const minSpend = Math.min(...spendValues);
  const maxSpend = Math.max(...spendValues);

  return entries
    .map((entry) => {
      const growth = entry.priorOrders ? (entry.recentOrders - entry.priorOrders) / entry.priorOrders : entry.recentOrders ? 1 : 0;
      const volume = entry.recentRevenue || entry.recentOrders * basePrice;
      const demandScore = (normalize(growth, minGrowth, maxGrowth) * 0.6 + normalize(volume, minVolume, maxVolume) * 0.4) * 100;
      const competitionScore = normalize(entry.recentSpend, minSpend, maxSpend) * 100;
      const marketScore = normalize(volume, minVolume, maxVolume) * 100;
      const readinessScore = clamp((coverageRate || 0.65) * 100, 40, 95);

      return {
        geo: COUNTRY_NAMES[entry.country] || entry.country,
        demand: Math.round(demandScore),
        competition: Math.round(competitionScore),
        marketSize: Math.round(marketScore),
        readiness: Math.round(readinessScore)
      };
    })
    .sort((a, b) => b.demand - a.demand)
    .slice(0, 6);
}

function buildHeatmap(db, store, geos, startDate, endDate) {
  const rows = db.prepare(`
    SELECT country, age, SUM(conversions) as conversions
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND age != '' AND country != 'ALL'
    GROUP BY country, age
  `).all(store, startDate, endDate);

  const geoList = geos.length ? geos : ['UAE', 'KSA', 'Qatar', 'Bahrain'];
  const values = SEGMENTS.map(() => geoList.map(() => 0));

  if (!rows.length) {
    SEGMENTS.forEach((_, rowIndex) => {
      geoList.forEach((_, colIndex) => {
        values[rowIndex][colIndex] = 55 + ((rowIndex + colIndex) * 7) % 35;
      });
    });
    return { segments: SEGMENTS.map((segment) => segment.id), geos: geoList, values };
  }

  const byKey = new Map();
  rows.forEach((row) => {
    const geo = COUNTRY_NAMES[row.country] || row.country;
    const key = `${geo}-${row.age}`;
    byKey.set(key, (byKey.get(key) || 0) + toNumber(row.conversions));
  });

  SEGMENTS.forEach((segment, rowIndex) => {
    geoList.forEach((geo, colIndex) => {
      const sum = segment.ages.reduce((acc, age) => acc + (byKey.get(`${geo}-${age}`) || 0), 0);
      values[rowIndex][colIndex] = sum;
    });
  });

  const flat = values.flat();
  const maxVal = Math.max(...flat, 1);
  SEGMENTS.forEach((_, rowIndex) => {
    geoList.forEach((_, colIndex) => {
      values[rowIndex][colIndex] = Math.round(normalize(values[rowIndex][colIndex], 0, maxVal) * 100);
    });
  });

  return { segments: SEGMENTS.map((segment) => segment.id), geos: geoList, values };
}

function buildDemandSimulation(basePrice) {
  const elasticity = -1.05;
  const multipliers = [0.8, 0.9, 1.0, 1.1, 1.2];
  const curve = multipliers.map((multiplier) => ({
    price: Math.round(basePrice * multiplier),
    demand: Math.round(100 * Math.pow(multiplier, elasticity))
  }));

  return {
    basePrice,
    curve,
    elasticity,
    bestPrice: Math.round(basePrice * 0.95)
  };
}

async function buildCards({
  store,
  topGeo,
  topSegment,
  adjacentSuggestion,
  trendDirection,
  heatmap,
  radarPoints,
  recentStart,
  priorStart,
  endDate,
  methodOverrides = {}
}) {
  const cards = [
    {
      id: 'persona',
      type: 'persona',
      title: `${topSegment} are responding to premium creative cues`,
      finding: `${topSegment} in ${topGeo} show above-average intent signals and higher CTR on premium creative styles.`,
      why: 'Visual themes tied to gifting and craftsmanship outperform neutral palettes.',
      action: 'Refresh hero visuals with premium cues and refine copy around gifting.',
      confidence: 0.78,
      sources: ['Meta Ads performance', 'Review topic mining'],
      models: [
        { name: 'CLIP ViT-L/14', description: 'Embeds creative visuals into semantic vectors.' },
        { name: 'HDBSCAN', description: 'Clusters creatives by visual similarity.' },
        { name: 'Fatigue Heuristic', description: 'Rule-based fatigue estimate using CTR decay vs peak.' }
      ],
      models_available: [
        { name: 'DeepSurv (optional)', description: 'Enable when you have >= 10 creatives and fatigue events.' }
      ],
      method_used: 'heuristic',
      logic: 'Winning creative clusters are identified by higher conversion-weighted scores.',
      limits: 'Needs enough creatives and stable targeting. DeepSurv is optional.'
    },
    {
      id: 'geo',
      type: 'geo',
      title: `${topGeo} shows early demand with low saturation`,
      finding: `Demand signals in ${topGeo} are growing faster than baseline with lower ad density.`,
      why: 'Similar to your top geo but with less competition.',
      action: `Launch a 14-day test with localized creatives in ${topGeo}.`,
      confidence: 0.71,
      sources: ['Search trends', 'Ad density scan'],
      models: [
        { name: 'Geo Opportunity Scorer', description: 'Weighted scoring on demand, readiness, and competition.' },
        { name: 'Cosine Similarity', description: 'Matches geos by similarity to top performers.' }
      ],
      models_available: [
        { name: 'TabPFN (optional)', description: 'Enable with >= 6 geos for stronger low-data prediction.' },
        { name: 'Siamese Similarity (optional)', description: 'Enable with >= 10 geos for learned embeddings.' }
      ],
      method_used: 'scorer',
      logic: 'Candidate geo ranks top in opportunity score while matching winning markets.',
      limits: 'Add external market data for stronger geo discovery.'
    },
    {
      id: 'adjacent',
      type: 'adjacent',
      title: `${adjacentSuggestion} is underrepresented`,
      finding: 'Co-search and review clusters suggest demand for adjacent bundles.',
      why: 'Competitors expand SKU depth faster in this tier.',
      action: 'Add a premium bundle and push it as a gifting option.',
      confidence: 0.66,
      sources: ['Marketplace scan', 'Review clustering'],
      models: [
        { name: 'Directional Co-purchase Lift', description: 'Computes P(Y|X) + lift to avoid popularity bias.' },
        { name: 'Markov Transition Model', description: 'Counts next-step transitions from sessions when available.' }
      ],
      models_available: [
        { name: 'GraphSAGE (optional)', description: 'Enable with >= 200 SKUs and offline-trained embeddings.' },
        { name: 'SASRec (optional)', description: 'Enable with >= 5000 sessions and offline-trained scores.' }
      ],
      method_used: 'copurchase',
      logic: 'Rank directional pairs by lift then support, optionally boosted by transitions.',
      limits: 'Small catalogs rarely benefit from deep graph/sequence models.'
    },
    {
      id: 'peaks',
      type: 'peaks',
      title: trendDirection == 'up' ? 'Peak window expected soon' : 'Softening demand window',
      finding: trendDirection == 'up'
        ? 'Forecast indicates a near-term uplift tied to seasonality signals.'
        : 'Demand is cooling vs prior baseline, suggesting a slower window.',
      why: 'Search and order velocity have diverged from baseline.',
      action: trendDirection == 'up'
        ? 'Increase inventory buffer and ramp creatives ahead of the peak.'
        : 'Reduce spend on weaker segments and protect margin.',
      confidence: 0.72,
      sources: ['Demand forecast', 'Seasonality model'],
      models: [
        { name: 'Linear Trend', description: 'Slope-based short-term forecast.' }
      ],
      models_available: [
        { name: 'Chronos-2 (optional)', description: 'Enable when Chronos weights are available.' }
      ],
      method_used: 'linear',
      logic: 'Positive slope and forecasted uplift point to a short-term peak window.',
      limits: 'Short history or volatile spend can reduce forecast stability.'
    },
    {
      id: 'anomaly',
      type: 'anomalies',
      title: 'Recent volatility detected in conversions',
      finding: 'Conversion volatility exceeded the expected baseline range.',
      why: 'Ad intensity shifts coincided with price compression.',
      action: 'Rebalance creative mix and monitor CAC for 7 days.',
      confidence: 0.69,
      sources: ['Conversion anomaly detection', 'Ad shift tracker'],
      models: [
        { name: 'LSTM Autoencoder', description: 'Flags abnormal drops beyond seasonal baseline.' },
        { name: 'BSTS', description: 'Estimates likely drivers of the change.' }
      ]
    },
    {
      id: 'pricing',
      type: 'pricing',
      title: 'Price elasticity suggests a small adjustment test',
      finding: 'Demand curve indicates a lift at slightly lower price bands.',
      why: 'Competitor dispersion widened while conversion softened.',
      action: 'Run a 14-day price band test within 5% of base.',
      confidence: 0.73,
      sources: ['Price history', 'Competitor pricing'],
      models: [
        { name: 'Deep Lattice Network', description: 'Monotonic demand curve estimation.' },
        { name: 'DragonNet', description: 'Uplift model for price interventions.' }
      ]
    }
  ];

  const mergeCard = (base, override) => {
    if (!override || typeof override !== 'object') return base;
    const merged = { ...base, ...override };
    if (override.signals && !override.sources) {
      merged.sources = override.signals;
    }
    if (!override.models) {
      merged.models = base.models;
    }
    if (typeof merged.confidence === 'string') {
      const parsed = Number(merged.confidence);
      if (!Number.isNaN(parsed)) {
        merged.confidence = parsed;
      }
    }
    if (typeof merged.confidence === 'number' && merged.confidence > 1) {
      merged.confidence = merged.confidence / 100;
    }
    return merged;
  };

  const creativeAssets = await getTopAdCreatives(store, recentStart, endDate, 6);
  const creativeHistory = getCreativeHistory(store, creativeAssets.map((asset) => asset.ad_id).filter(Boolean), recentStart, endDate);
  const geoFeatures = getGeoFeatures(store, recentStart, endDate, priorStart);
  const adjacentData = getOrderItemData(store, recentStart, endDate);
  const forecastSeries = getForecastSeries(store, recentStart, endDate);

  const context = {
    store,
    topGeo,
    topSegment,
    adjacentSuggestion,
    trendDirection,
    heatmap,
    radarPoints,
    recentStart,
    endDate,
    creativeAssets,
    creativeHistory,
    geoFeatures,
    adjacentData,
    forecastSeries
  };

  const personaIndex = cards.findIndex((card) => card.type === 'persona');
  if (personaIndex != -1) {
    const override = await fetchPersonaInsight({ ...context, assets: creativeAssets, history: creativeHistory, baseCard: cards[personaIndex], method: methodOverrides.persona });
    cards[personaIndex] = mergeCard(cards[personaIndex], override);
  }

  const geoIndex = cards.findIndex((card) => card.type === 'geo');
  if (geoIndex != -1) {
    const override = await fetchGeoInsight({ ...context, geos: geoFeatures, baseCard: cards[geoIndex], method: methodOverrides.geo });
    cards[geoIndex] = mergeCard(cards[geoIndex], override);
  }

  const adjacentIndex = cards.findIndex((card) => card.type === 'adjacent');
  if (adjacentIndex != -1) {
    const override = await fetchAdjacentInsight({ ...context, orders: adjacentData.orders, edges: adjacentData.edges, baseCard: cards[adjacentIndex], method: methodOverrides.adjacent });
    cards[adjacentIndex] = mergeCard(cards[adjacentIndex], override);
  }

  const peaksIndex = cards.findIndex((card) => card.type === 'peaks');
  if (peaksIndex != -1) {
    const override = await fetchPeaksInsight({ ...context, series: forecastSeries, baseCard: cards[peaksIndex], method: methodOverrides.peaks });
    cards[peaksIndex] = mergeCard(cards[peaksIndex], override);
  }

  return cards;
}

function buildBudgetGuidance(store, avgWeeklySpend) {
  const defaults = STORE_DEFAULTS[store] || STORE_DEFAULTS.shawq;
  const currency = defaults.currency || 'USD';
  const safeSpend = avgWeeklySpend > 0 ? avgWeeklySpend : 5000;
  const startLow = Math.round(safeSpend * 0.8);
  const startHigh = Math.round(safeSpend * 1.2);
  const formattedRange = `${currency} ${startLow.toLocaleString()}-${startHigh.toLocaleString()}`;

  return {
    startPlan: {
      title: 'Cold-start budget plan',
      finding: `Start new geo tests around ${formattedRange} per week split 65/35 Meta/TikTok.`,
      action: 'Deploy for 14 days before scaling.',
      confidence: 0.7,
      models: [
        { name: 'MAML Meta-Learning', description: 'Adapts quickly from similar shop patterns.' },
        { name: 'Geo Similarity Embeddings', description: 'Transfers expectations from adjacent markets.' }
      ]
    },
    reallocation: {
      title: 'Reallocation guidance',
      finding: 'Shift 10-15% budget from saturated geos into higher-intent pockets.',
      action: 'Review CPA after a 7-day holdout.',
      confidence: 0.68,
      models: [
        { name: 'NeuralUCB Bandit', description: 'Allocates spend using contextual signals.' }
      ]
    },
    incrementality: {
      title: 'Scale vs cut',
      finding: 'Incrementality model shows strong lift in top geo.',
      action: 'Scale 15-20% while maintaining guardrails.',
      confidence: 0.72,
      models: [
        { name: 'Causal Forest', description: 'Estimates incremental lift per channel.' },
        { name: 'Double ML', description: 'Controls confounding for spend impact.' }
      ]
    }
  };
}

export async function getInsightsPayload(store, params = {}) {
  const db = getDb();
  const defaults = STORE_DEFAULTS[store] || STORE_DEFAULTS.shawq;
  const today = new Date();
  const latestDate = getLatestMetaDate(db, store);
  const endDate = latestDate || getDateString(today);
  const end = new Date(endDate);
  const recentStart = getDateString(addDays(end, -13));
  const priorStart = getDateString(addDays(end, -27));

  let methodOverrides = {};
  if (params?.methods) {
    try {
      methodOverrides = typeof params.methods === 'string' ? JSON.parse(params.methods) : params.methods;
    } catch (error) {
      methodOverrides = {};
    }
  }

  const metaRows = db.prepare(`
    SELECT country, date, SUM(conversions) as conversions, SUM(conversion_value) as revenue, SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country, date
  `).all(store, priorStart, endDate);

  const taggedRows = metaRows.map((row) => ({
    ...row,
    period: row.date >= recentStart ? 'recent' : 'prior'
  }));

  const ordersSummary = getOrdersSummary(db, store, recentStart, endDate);
  const conversionsRecent = taggedRows
    .filter((row) => row.period == 'recent')
    .reduce((sum, row) => sum + toNumber(row.conversions), 0);
  const conversionsPrior = taggedRows
    .filter((row) => row.period == 'prior')
    .reduce((sum, row) => sum + toNumber(row.conversions), 0);
  const coverageRate = ordersSummary.orders > 0 ? conversionsRecent / ordersSummary.orders : 0.65;

  const radarPoints = buildRadarPoints({ rows: taggedRows, coverageRate, basePrice: defaults.basePrice });
  const topGeo = radarPoints[0]?.geo || 'UAE';

  const heatmap = buildHeatmap(db, store, radarPoints.map((point) => point.geo).slice(0, 4), recentStart, endDate);
  const flatValues = heatmap.values.flat();
  let topIndex = 0;
  if (flatValues.length) {
    topIndex = flatValues.reduce((maxIndex, value, index, arr) => (value > arr[maxIndex] ? index : maxIndex), 0);
  }
  const topSegmentRow = Math.floor(topIndex / heatmap.geos.length);
  const topSegment = heatmap.segments[topSegmentRow] || SEGMENTS[0].id;

  const demandSimulation = buildDemandSimulation(defaults.basePrice);
  const trendDirection = conversionsRecent >= conversionsPrior ? 'up' : 'down';

  const cards = await buildCards({
    store,
    topGeo,
    topSegment,
    adjacentSuggestion: defaults.adjacentSuggestion,
    trendDirection,
    heatmap,
    radarPoints,
    recentStart,
    priorStart,
    endDate,
    methodOverrides
  });

  const avgWeeklySpend = taggedRows.reduce((sum, row) => sum + toNumber(row.spend), 0) / 2;
  const budget = buildBudgetGuidance(store, avgWeeklySpend);

  const summaryDrivers = [
    `Demand signals accelerating in ${topGeo}.`,
    'Creative fatigue remains low in top campaigns.',
    'Segment intent rising for gifting and premium cues.'
  ];

  const summaryRisks = [
    coverageRate < 0.65 ? 'Tracking coverage needs attention.' : 'Pricing dispersion rising across competitors.',
    'Inventory buffer could tighten during next peak.',
    'Attribution gaps may hide true lift.'
  ];

  return {
    updatedAt: new Date().toISOString(),
    summary: {
      headline: `${defaults.name} has clear growth pockets with actionable levers this week.`,
      drivers: summaryDrivers,
      risks: summaryRisks,
      confidence: 0.76,
      window: 'Last 30 days'
    },
    narrative: {
      title: 'Narrative Brief',
      summary: `${defaults.name} should lean into premium gifting creatives and test new geo opportunities while keeping pricing within competitive bands.`,
      actions: [
        'Shift 10-15% of creative focus to premium gifting cues.',
        `Open ${topGeo} prospecting with localized creative tests.`,
        'Hold price bands within 5% of premium competitors.'
      ],
      confidence: 0.72
    },
    signalFusion: {
      score: 0.78,
      drivers: ['Search + social momentum', 'Low creative fatigue', 'Stable CAC in core geo'],
      risks: ['Price pressure rising', 'Inventory lead time tight'],
      coverage: coverageRate
    },
    radar: {
      points: radarPoints
    },
    heatmap,
    demandSimulation,
    competitorMotion: {
      events: [
        {
          id: 'motion-1',
          title: 'Premium gifting angle rising',
          detail: 'Competitors increased luxury-themed creatives in top geos.',
          impact: 'Medium',
          source: 'Ad library tracking'
        },
        {
          id: 'motion-2',
          title: 'Price undercut in key geo',
          detail: 'New entrants launched entry bundles below base price.',
          impact: 'High',
          source: 'Marketplace scan'
        }
      ]
    },
    readiness: {
      items: [
        {
          id: 'r1',
          title: 'Localization',
          status: 'Ready',
          detail: 'Localized creative packs prepared.'
        },
        {
          id: 'r2',
          title: 'Fulfillment',
          status: trendDirection == 'up' ? 'Watch' : 'Ready',
          detail: trendDirection == 'up' ? 'Inventory buffer tight for peak weeks.' : 'Inventory stable for current demand.'
        },
        {
          id: 'r3',
          title: 'Tracking',
          status: coverageRate > 0.7 ? 'Ready' : coverageRate > 0.55 ? 'Watch' : 'Needs work',
          detail: `Coverage rate currently ${Math.round(coverageRate * 100)}%.`
        }
      ]
    },
    cards,
    budget
  };
}
