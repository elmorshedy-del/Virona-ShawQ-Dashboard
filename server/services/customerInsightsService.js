import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { getCountryInfo } from '../utils/countryData.js';
import { ensureShopifyProductsCached } from './shopifyService.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toNumber = (value) => (Number.isFinite(value) ? value : 0);
const safeDivide = (num, den) => (den ? num / den : 0);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ARABIC_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const TIP_REGEX = /\btip\b|gratuity/i;

const DEFAULT_STORE_TIMEZONE = process.env.STORE_TIMEZONE_DEFAULT || 'UTC';

const normalizeStoreEnvKey = (store) =>
  String(store || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');

function getStoreTimeZone(store) {
  const key = `STORE_TIMEZONE_${normalizeStoreEnvKey(store)}`;
  const fallback = DEFAULT_STORE_TIMEZONE;
  const configured = process.env[key] || fallback;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured });
    return configured;
  } catch (e) {
    return fallback;
  }
}

function getMinSegmentOrders(totalOrders) {
  const configured = parseInt(process.env.CUSTOMER_INSIGHTS_MIN_SEGMENT_ORDERS || '', 10);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (!totalOrders) return 3;
  return Math.max(3, Math.min(10, Math.round(totalOrders * 0.05)));
}

function sanitizeProductLabel(label) {
  if (!label || typeof label !== 'string') return label;
  const cleaned = label.replace(ARABIC_REGEX, '').replace(/\s+/g, ' ').trim();
  return cleaned || label.trim();
}

function isTipItem(row) {
  const text = [row?.title, row?.cache_title, row?.sku].filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return TIP_REGEX.test(text);
}

function getItemIdentity(row) {
  const key = row?.variant_id || row?.product_id || row?.sku || row?.title;
  if (!key) return { key: null, label: null };

  if (isTipItem(row)) return { key: null, label: null };

  const title = typeof row?.title === 'string' ? row.title.trim() : '';
  const cacheTitle = typeof row?.cache_title === 'string' ? row.cache_title.trim() : '';
  const sku = typeof row?.sku === 'string' ? row.sku.trim() : '';

  let label = title || sku || '';
  if ((!label || /^\d+$/.test(label)) && cacheTitle && !/^\d+$/.test(cacheTitle)) {
    label = cacheTitle;
  }

  if (!label || /^\d+$/.test(label)) {
    if (row?.sku && !/^\d+$/.test(String(row.sku))) {
      label = String(row.sku);
    } else if (row?.product_id) {
      label = `Product ${row.product_id}`;
    } else if (row?.variant_id) {
      label = `Variant ${row.variant_id}`;
    } else {
      label = String(key);
    }
  }

  return {
    key: String(key),
    label: sanitizeProductLabel(label)
  };
}

function getProductKey(row) {
  if (isTipItem(row)) return null;
  return row?.product_id || row?.variant_id || row?.sku || row?.title || null;
}

function getProductLabel(row) {
  const identity = getItemIdentity(row);
  return identity.label;
}

function getDateRange(params) {
  const now = new Date();
  const today = formatDateAsGmt3(now);

  if (params.startDate && params.endDate) {
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    const days = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;
    return { startDate: params.startDate, endDate: params.endDate, days };
  }

  if (params.yesterday) {
    const yesterday = formatDateAsGmt3(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return { startDate: yesterday, endDate: yesterday, days: 1 };
  }

  let days = 7;
  if (params.days) days = parseInt(params.days, 10);
  else if (params.weeks) days = parseInt(params.weeks, 10) * 7;
  else if (params.months) days = parseInt(params.months, 10) * 30;

  const endDate = today;
  const startMs = now.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  const startDate = formatDateAsGmt3(new Date(startMs));

  return { startDate, endDate, days };
}

function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + deltaDays);
  return formatDateAsGmt3(d);
}

function getOrdersTable(store) {
  return store === 'vironax' ? 'salla_orders' : 'shopify_orders';
}

function getOrderRows(db, store, startDate, endDate) {
  const table = getOrdersTable(store);
  if (table === 'shopify_orders') {
    return db.prepare(`
      SELECT
        order_id,
        date,
        country,
        country_code,
        city,
        state,
        order_total,
        subtotal,
        discount,
        order_created_at as order_ts,
        customer_id,
        customer_email
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ?
    `).all(store, startDate, endDate);
  }

  return db.prepare(`
    SELECT
      order_id,
      date,
      country,
      country_code,
      city,
      state,
      order_total,
      subtotal,
      discount,
      created_at as order_ts,
      NULL as customer_id,
      NULL as customer_email
    FROM salla_orders
    WHERE store = ? AND date BETWEEN ? AND ?
  `).all(store, startDate, endDate);
}

function getOrderItems(db, store, startDate, endDate) {
  if (store !== 'shawq') return [];
  return db.prepare(`
    SELECT
      oi.order_id,
      oi.product_id,
      oi.variant_id,
      oi.sku,
      COALESCE(NULLIF(oi.title, ''), pc.title) as title,
      COALESCE(NULLIF(oi.image_url, ''), pc.image_url) as image_url,
      pc.title as cache_title,
      oi.quantity,
      oi.price,
      oi.discount,
      o.customer_id,
      o.order_created_at,
      o.date
    FROM shopify_order_items oi
    JOIN shopify_orders o
      ON o.order_id = oi.order_id AND o.store = oi.store
    LEFT JOIN shopify_products_cache pc
      ON pc.store = oi.store AND pc.product_id = oi.product_id
    WHERE o.store = ? AND o.date BETWEEN ? AND ?
  `).all(store, startDate, endDate);
}

function computeDiscountMetrics(orders) {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, row) => sum + toNumber(row.order_total), 0);
  let discountedOrders = 0;
  let discountedRevenue = 0;
  let discountRateSum = 0;
  let discountRateCount = 0;
  let discountedAovSum = 0;
  let discountedAovCount = 0;
  let fullAovSum = 0;
  let fullAovCount = 0;

  orders.forEach((row) => {
    const discount = toNumber(row.discount);
    const subtotal = toNumber(row.subtotal);
    const revenue = toNumber(row.order_total);

    if (discount > 0) {
      discountedOrders += 1;
      discountedRevenue += revenue;
      discountedAovSum += revenue;
      discountedAovCount += 1;
      if (subtotal > 0) {
        discountRateSum += discount / subtotal;
        discountRateCount += 1;
      }
    } else {
      fullAovSum += revenue;
      fullAovCount += 1;
    }
  });

  return {
    discountedOrders,
    discountOrderRate: safeDivide(discountedOrders, totalOrders),
    discountedRevenue,
    discountRevenueShare: safeDivide(discountedRevenue, totalRevenue),
    avgDiscountRate: discountRateCount ? discountRateSum / discountRateCount : 0,
    avgDiscountedAov: discountedAovCount ? discountedAovSum / discountedAovCount : 0,
    avgFullAov: fullAovCount ? fullAovSum / fullAovCount : 0
  };
}

function computeCustomerStats(orders) {
  const customers = new Map();
  orders.forEach((row) => {
    const customerId = row.customer_id || null;
    if (!customerId) return;
    const entry = customers.get(customerId) || { orders: 0, revenue: 0, firstTs: null, orderEvents: [] };
    entry.orders += 1;
    const amount = toNumber(row.order_total);
    entry.revenue += amount;
    const ts = row.order_ts ? new Date(row.order_ts) : null;
    if (ts && !Number.isNaN(ts.getTime())) {
      entry.orderEvents.push({ ts, amount });
      if (!entry.firstTs || ts < entry.firstTs) entry.firstTs = ts;
    }
    customers.set(customerId, entry);
  });

  const customerCount = customers.size;
  if (!customerCount) {
    return { customerCount: 0, repeatRate: null, avgLtv90: null, cohorts: [] };
  }

  let repeatCustomers = 0;
  let ltv90Sum = 0;

  const cohorts = new Map();

  customers.forEach((entry) => {
    if (entry.orders >= 2) repeatCustomers += 1;

    const firstTs = entry.firstTs;
    if (firstTs) {
      const horizon30 = new Date(firstTs.getTime() + 30 * 24 * 60 * 60 * 1000);
      const horizon60 = new Date(firstTs.getTime() + 60 * 24 * 60 * 60 * 1000);
      const horizon90 = new Date(firstTs.getTime() + 90 * 24 * 60 * 60 * 1000);

      let rev30 = 0;
      let rev60 = 0;
      let rev90 = 0;

      entry.orderEvents.forEach((event) => {
        if (event.ts <= horizon30) rev30 += event.amount;
        if (event.ts <= horizon60) rev60 += event.amount;
        if (event.ts <= horizon90) rev90 += event.amount;
      });

      ltv90Sum += rev90;

      const cohortKey = `${firstTs.getFullYear()}-${String(firstTs.getMonth() + 1).padStart(2, '0')}`;
      const cohort = cohorts.get(cohortKey) || { cohort: cohortKey, customers: 0, ltv30: 0, ltv60: 0, ltv90: 0 };
      cohort.customers += 1;
      cohort.ltv30 += rev30;
      cohort.ltv60 += rev60;
      cohort.ltv90 += rev90;
      cohorts.set(cohortKey, cohort);
    }
  });

  const cohortRows = Array.from(cohorts.values())
    .sort((a, b) => (a.cohort < b.cohort ? 1 : -1))
    .slice(0, 6)
    .map((row) => ({
      cohort: row.cohort,
      customers: row.customers,
      ltv30: row.customers ? row.ltv30 / row.customers : 0,
      ltv60: row.customers ? row.ltv60 / row.customers : 0,
      ltv90: row.customers ? row.ltv90 / row.customers : 0
    }));

  return {
    customerCount,
    repeatRate: safeDivide(repeatCustomers, customerCount),
    avgLtv90: ltv90Sum / customerCount,
    cohorts: cohortRows
  };
}

function getMetaTopSegment(db, store, startDate, endDate) {
  const row = db.prepare(`
    SELECT country, age, gender,
      SUM(conversions) as conversions,
      SUM(conversion_value) as revenue,
      SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND conversions > 0
    GROUP BY country, age, gender
    ORDER BY revenue DESC
    LIMIT 1
  `).get(store, startDate, endDate);

  if (!row || !row.country || row.country === 'ALL') return null;

  const age = (row.age || '').trim();
  const gender = (row.gender || '').toLowerCase().trim();

  const genderLabel = gender === 'female' ? 'Women' : gender === 'male' ? 'Men' : null;
  const ageLabel = age || null;

  // Ignore "All ages / All genders" rows; we only surface meaningful breakdowns.
  if (!genderLabel && !ageLabel) return null;

  const country = getCountryInfo(row.country);

  const labelParts = [];
  if (genderLabel) labelParts.push(genderLabel);
  if (ageLabel) labelParts.push(ageLabel);
  labelParts.push(`in ${country.name}`);

  return {
    label: labelParts.join(' '),
    country: country.name,
    age: ageLabel,
    gender: genderLabel,
    conversions: toNumber(row.conversions),
    revenue: toNumber(row.revenue),
    spend: toNumber(row.spend)
  };
}

function getTopTiming(orders, store) {
  const hourCounts = new Array(24).fill(0);
  const dayCounts = new Array(7).fill(0);

  const timeZone = getStoreTimeZone(store);
  let formatter;

  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
      weekday: 'long'
    });
  } catch (e) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_STORE_TIMEZONE,
      hour: '2-digit',
      hour12: false,
      weekday: 'long'
    });
  }

  orders.forEach((row) => {
    if (!row.order_ts) return;
    const ts = new Date(row.order_ts);
    if (Number.isNaN(ts.getTime())) return;

    const parts = formatter.formatToParts(ts);
    const hourPart = parts.find((part) => part.type === 'hour')?.value;
    const weekdayPart = parts.find((part) => part.type === 'weekday')?.value;

    const hour = hourPart != null ? parseInt(hourPart, 10) : Number.NaN;
    if (!Number.isNaN(hour)) hourCounts[clamp(hour, 0, 23)] += 1;

    const dayIndex = weekdayPart ? DAY_NAMES.indexOf(weekdayPart) : -1;
    if (dayIndex >= 0) dayCounts[dayIndex] += 1;
  });

  const topHour = hourCounts.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: 0, count: 0 }
  );
  const topDay = dayCounts.reduce(
    (best, count, day) => (count > best.count ? { day, count } : best),
    { day: 0, count: 0 }
  );

  return {
    hourCounts,
    dayCounts,
    topHour,
    topDay,
    timeZone
  };
}

function describeDaypart(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late night';
}

function computeBundles(items) {
  const orderMap = new Map();
  const labelByKey = new Map();

  items.forEach((row) => {
    if (!row.order_id) return;
    const productKey = getProductKey(row);
    if (!productKey) return;
    const label = getProductLabel(row);
    if (label && !labelByKey.has(productKey)) labelByKey.set(productKey, label);

    const entry = orderMap.get(row.order_id) || new Set();
    entry.add(String(productKey));
    orderMap.set(row.order_id, entry);
  });

  const itemCounts = new Map();
  const pairCounts = new Map();

  orderMap.forEach((products) => {
    const arr = Array.from(products);
    arr.forEach((p) => itemCounts.set(p, (itemCounts.get(p) || 0) + 1));
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const [a, b] = [arr[i], arr[j]].sort();
        const key = `${a}||${b}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  });

  const totalOrders = orderMap.size;
  const pairs = [];

  pairCounts.forEach((count, key) => {
    if (count < 2) return;
    const [a, b] = key.split('||');
    const support = safeDivide(count, totalOrders);
    const attach = safeDivide(count, itemCounts.get(a) || 0);
    const lift = attach && totalOrders ? attach / safeDivide(itemCounts.get(b) || 0, totalOrders) : 0;

    const labelA = labelByKey.get(a) || a;
    const labelB = labelByKey.get(b) || b;

    pairs.push({
      pair: [labelA, labelB],
      pairKeys: [a, b],
      count,
      support,
      attach,
      lift
    });
  });

  return pairs.sort((a, b) => b.lift - a.lift).slice(0, 8);
}

function computeRepeatPaths(items) {
  const ordersById = new Map();
  const labelByKey = new Map();

  items.forEach((row) => {
    if (!row.order_id) return;
    const entry = ordersById.get(row.order_id) || {
      order_id: row.order_id,
      customer_id: row.customer_id,
      ts: row.order_created_at ? new Date(row.order_created_at) : null,
      products: new Map()
    };

    const productKey = getProductKey(row);
    if (!productKey) return;
    const label = getProductLabel(row);
    if (label && !labelByKey.has(productKey)) labelByKey.set(productKey, label);

    const revenue = toNumber(row.price) * toNumber(row.quantity || 1);
    entry.products.set(String(productKey), (entry.products.get(String(productKey)) || 0) + revenue);
    ordersById.set(row.order_id, entry);
  });

  const customerOrders = new Map();
  ordersById.forEach((order) => {
    if (!order.customer_id || order.products.size === 0) return;
    const list = customerOrders.get(order.customer_id) || [];
    list.push(order);
    customerOrders.set(order.customer_id, list);
  });

  const transitions = new Map();

  const pickPrimaryProduct = (products) => {
    let bestKey = null;
    let bestRevenue = -1;
    products.forEach((revenue, key) => {
      if (revenue > bestRevenue) {
        bestRevenue = revenue;
        bestKey = key;
      }
    });
    return bestKey;
  };

  customerOrders.forEach((list) => {
    list.sort((a, b) => {
      const at = a.ts ? a.ts.getTime() : 0;
      const bt = b.ts ? b.ts.getTime() : 0;
      return at - bt;
    });

    for (let i = 0; i < list.length - 1; i += 1) {
      const fromKey = pickPrimaryProduct(list[i].products);
      const toKey = pickPrimaryProduct(list[i + 1].products);
      if (!fromKey || !toKey || fromKey === toKey) continue;
      const key = `${fromKey}||${toKey}`;
      transitions.set(key, (transitions.get(key) || 0) + 1);
    }
  });

  return Array.from(transitions.entries())
    .map(([key, count]) => {
      const [fromKey, toKey] = key.split('||');
      return {
        from: labelByKey.get(fromKey) || fromKey,
        to: labelByKey.get(toKey) || toKey,
        fromKey,
        toKey,
        count
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function computeTopProducts(items) {
  const byProduct = new Map();

  items.forEach((row) => {
    const productKey = getProductKey(row);
    if (!productKey || !row.order_id) return;
    const label = getProductLabel(row) || 'Product';

    const entry = byProduct.get(productKey) || {
      key: String(productKey),
      title: label,
      image_url: row.image_url || null,
      quantity: 0,
      revenue: 0,
      orderIds: new Set()
    };

    if (!entry.image_url && row.image_url) entry.image_url = row.image_url;
    if ((!entry.title || /^Product\s\d+$/.test(entry.title)) && label) entry.title = label;

    const quantity = toNumber(row.quantity || 1);
    const revenue = toNumber(row.price) * quantity;

    entry.quantity += quantity;
    entry.revenue += revenue;
    entry.orderIds.add(row.order_id);

    byProduct.set(productKey, entry);
  });

  return Array.from(byProduct.values())
    .map((row) => ({
      key: row.key,
      title: row.title,
      image_url: row.image_url,
      quantity: row.quantity,
      revenue: row.revenue,
      orders: row.orderIds.size
    }))
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.orders !== a.orders) return b.orders - a.orders;
      return b.quantity - a.quantity;
    })
    .slice(0, 12);
}

function computeProductMetrics(items) {
  const byProduct = new Map();

  items.forEach((row) => {
    const productKey = getProductKey(row);
    if (!productKey || !row.order_id) return;
    const label = getProductLabel(row) || 'Product';

    const entry = byProduct.get(productKey) || {
      key: String(productKey),
      title: label,
      revenue: 0,
      orders: 0,
      orderIds: new Set()
    };

    if ((!entry.title || /^Product\s\d+$/.test(entry.title)) && label) entry.title = label;

    const quantity = toNumber(row.quantity || 1);
    const revenue = toNumber(row.price) * quantity;

    entry.revenue += revenue;
    entry.orderIds.add(row.order_id);

    byProduct.set(productKey, entry);
  });

  return new Map(Array.from(byProduct.entries()).map(([key, row]) => [key, {
    ...row,
    orders: row.orderIds.size
  }]));
}

function rankProducts(metricsMap) {
  const sorted = Array.from(metricsMap.values())
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.orders !== a.orders) return b.orders - a.orders;
      return a.title.localeCompare(b.title);
    });

  const ranks = new Map();
  sorted.forEach((row, index) => {
    ranks.set(row.key, index + 1);
  });

  return { sorted, ranks };
}

function computeProductShiftInsights(currentItems, previousItems, minOrders = 2) {
  const currentMetrics = computeProductMetrics(currentItems);
  const previousMetrics = computeProductMetrics(previousItems);

  if (!currentMetrics.size) return [];

  const { ranks: currentRanks } = rankProducts(currentMetrics);
  const { ranks: previousRanks } = rankProducts(previousMetrics);

  const candidates = [];

  currentMetrics.forEach((current) => {
    const prev = previousMetrics.get(current.key);
    const prevRank = previousRanks.get(current.key) || null;
    const currRank = currentRanks.get(current.key) || null;
    const prevRevenue = prev?.revenue || 0;
    const currRevenue = current.revenue || 0;
    const revenueDelta = currRevenue - prevRevenue;
    const revenueLift = prevRevenue > 0 ? revenueDelta / prevRevenue : null;
    const rankDelta = prevRank ? prevRank - currRank : null;
    const isNew = !prevRank && current.orders >= minOrders;

    if (current.orders < minOrders && (!prev || prev.orders < minOrders)) return;

    const significant = isNew || (prevRank && (Math.abs(rankDelta || 0) >= 3 || (revenueLift != null && Math.abs(revenueLift) >= 0.5)));
    if (!significant) return;

    candidates.push({
      key: current.key,
      title: current.title,
      currRank,
      prevRank,
      rankDelta,
      revenueDelta,
      revenueLift,
      currOrders: current.orders,
      prevOrders: prev?.orders || 0,
      isNew
    });
  });

  if (!candidates.length) return [];

  const gainers = candidates.filter((c) => c.isNew || (c.rankDelta != null && c.rankDelta > 0) || (c.revenueLift != null && c.revenueLift > 0));
  const decliners = candidates.filter((c) => (c.rankDelta != null && c.rankDelta < 0) || (c.revenueLift != null && c.revenueLift < -0.25));

  gainers.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if ((b.rankDelta || 0) !== (a.rankDelta || 0)) return (b.rankDelta || 0) - (a.rankDelta || 0);
    return (b.revenueLift || 0) - (a.revenueLift || 0);
  });

  decliners.sort((a, b) => {
    if ((a.rankDelta || 0) !== (b.rankDelta || 0)) return (a.rankDelta || 0) - (b.rankDelta || 0);
    return (a.revenueLift || 0) - (b.revenueLift || 0);
  });

  const insights = [];
  const topGainer = gainers[0];
  const topDecliner = decliners[0];

  if (topGainer) {
    const moveLabel = topGainer.isNew
      ? 'New entrant at #' + topGainer.currRank
      : 'Up ' + topGainer.rankDelta + ' spots to #' + topGainer.currRank;
    const liftLabel = topGainer.revenueLift != null
      ? 'Revenue ' + (topGainer.revenueLift >= 0 ? 'up' : 'down') + ' ' + Math.abs(topGainer.revenueLift * 100).toFixed(0) + '%'
      : 'Revenue +' + topGainer.revenueDelta.toFixed(0);
    insights.push({
      id: 'product-mover-up',
      title: topGainer.title + ' surged',
      detail: moveLabel + '. ' + liftLabel + ' vs last window.',
      impact: 'Product momentum',
      confidence: scoreConfidence(Math.max(topGainer.currOrders, topGainer.prevOrders))
    });
  }

  if (topDecliner) {
    const moveLabel = 'Down ' + Math.abs(topDecliner.rankDelta || 0) + ' spots to #' + topDecliner.currRank;
    const liftLabel = topDecliner.revenueLift != null
      ? 'Revenue down ' + Math.abs(topDecliner.revenueLift * 100).toFixed(0) + '%'
      : 'Revenue ' + topDecliner.revenueDelta.toFixed(0);
    insights.push({
      id: 'product-mover-down',
      title: topDecliner.title + ' softened',
      detail: moveLabel + '. ' + liftLabel + ' vs last window.',
      impact: 'Product watch',
      confidence: scoreConfidence(Math.max(topDecliner.currOrders, topDecliner.prevOrders))
    });
  }

  return insights;
}


function computeDiscountSkus(items) {
  const bySku = new Map();
  items.forEach((row) => {
    const { key, label } = getItemIdentity(row);
    const itemKey = key || row.title || row.product_id || row.sku;
    const itemLabel = label || row.title || row.product_id || row.sku;
    if (!itemKey || !itemLabel) return;

    const lookupKey = String(itemKey);
    const displayLabel = String(itemLabel);

    const entry = bySku.get(lookupKey) || {
      key: lookupKey,
      title: displayLabel,
      orders: 0,
      revenue: 0,
      discountedRevenue: 0,
      discountCount: 0
    };

    const revenue = toNumber(row.price) * toNumber(row.quantity || 1);
    entry.orders += 1;
    entry.revenue += revenue;
    if (toNumber(row.discount) > 0) {
      entry.discountedRevenue += revenue;
      entry.discountCount += 1;
    }
    bySku.set(lookupKey, entry);
  });

  return Array.from(bySku.values())
    .filter((row) => row.orders >= 3)
    .map((row) => ({
      title: row.title,
      discountShare: safeDivide(row.discountedRevenue, row.revenue),
      discountedOrders: row.discountCount,
      orders: row.orders
    }))
    .sort((a, b) => b.discountShare - a.discountShare)
    .slice(0, 8);
}

function scoreConfidence(sampleSize) {
  if (!sampleSize) return 0.25;
  return clamp(sampleSize / 80, 0.35, 0.95);
}

function buildInsights({ discountMetrics, repeatRate, topDay, topHour, bundleTop, segmentLabel, productShiftInsights }) {
  const insights = [];

  if (discountMetrics.discountRevenueShare > 0.35) {
    insights.push({
      id: 'discount-reliance',
      title: 'Discount-driven revenue is high',
      detail: `Discounted orders contribute ${(discountMetrics.discountRevenueShare * 100).toFixed(1)}% of revenue.`,
      impact: 'Margin risk',
      confidence: scoreConfidence(discountMetrics.discountedOrders)
    });
  } else {
    insights.push({
      id: 'price-integrity',
      title: 'Strong full-price mix',
      detail: `Only ${(discountMetrics.discountRevenueShare * 100).toFixed(1)}% of revenue is discounted.`,
      impact: 'Healthy margin base',
      confidence: scoreConfidence(discountMetrics.discountedOrders)
    });
  }

  if (repeatRate != null) {
    insights.push({
      id: 'repeat-rate',
      title: repeatRate < 0.25 ? 'Repeat rate opportunity' : 'Repeat rate is healthy',
      detail: `Repeat customers represent ${(repeatRate * 100).toFixed(1)}% of buyers in this window.`,
      impact: repeatRate < 0.25 ? 'Retention upside' : 'Retention strength',
      confidence: repeatRate
    });
  }

  if (topDay && topHour) {
    insights.push({
      id: 'timing',
      title: `Peak demand hits on ${DAY_NAMES[topDay.day]}`,
      detail: `Most orders arrive around ${topHour.hour}:00 (${describeDaypart(topHour.hour)}).`,
      impact: 'Media timing',
      confidence: scoreConfidence(topDay.count)
    });
  }

  if (bundleTop) {
    insights.push({
      id: 'bundle',
      title: 'Bundle opportunity spotted',
      detail: `${bundleTop.pair[0]} + ${bundleTop.pair[1]} shows high lift (${bundleTop.lift.toFixed(2)}x).`,
      impact: 'AOV lift',
      confidence: scoreConfidence(bundleTop.count)
    });
  }

  if (productShiftInsights?.length) {
    insights.push(...productShiftInsights);
  }

  if (segmentLabel) {
    insights.push({
      id: 'segment',
      title: 'Best segment detected',
      detail: segmentLabel,
      impact: 'Targeting focus',
      confidence: 0.7
    });
  }

  return insights.slice(0, 3);
}

export async function getCustomerInsightsPayload(store, params = {}) {
  const db = getDb();
  const { startDate, endDate, days } = getDateRange(params);

  const orders = getOrderRows(db, store, startDate, endDate);
  let items = getOrderItems(db, store, startDate, endDate);

  const prevStartDate = shiftDate(startDate, -days);
  const prevEndDate = shiftDate(endDate, -days);
  let previousItems = store === 'shawq' ? getOrderItems(db, store, prevStartDate, prevEndDate) : [];

  if (store === 'shawq' && (items.length || previousItems.length)) {
    const productIds = Array.from(new Set(
      items.concat(previousItems)
        .map((row) => row.product_id)
        .filter(Boolean)
        .map((id) => String(id))
    ));
    if (productIds.length) {
      await ensureShopifyProductsCached(store, productIds);
      items = getOrderItems(db, store, startDate, endDate);
      previousItems = getOrderItems(db, store, prevStartDate, prevEndDate);
    }
  }

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, row) => sum + toNumber(row.order_total), 0);
  const avgOrderValue = safeDivide(totalRevenue, totalOrders);

  const discountMetrics = computeDiscountMetrics(orders);
  const customerStats = computeCustomerStats(orders);
  const metaSegment = getMetaTopSegment(db, store, startDate, endDate);
  const timing = getTopTiming(orders, store);
  const bundles = computeBundles(items);
  const repeatPaths = computeRepeatPaths(items);
  const topProducts = computeTopProducts(items);
  const discountSkus = computeDiscountSkus(items);
  const productShiftInsights = computeProductShiftInsights(items, previousItems, 2);

  const topCountry = orders.reduce((best, row) => {
    if (!row.country_code && !row.country) return best;
    const code = row.country_code || row.country;
    const entry = best.map.get(code) || { code, revenue: 0, orders: 0 };
    entry.revenue += toNumber(row.order_total);
    entry.orders += 1;
    best.map.set(code, entry);
    return best;
  }, { map: new Map() });

  const countryRows = Array.from(topCountry.map.values())
    .map((row) => ({
      code: row.code,
      name: getCountryInfo(row.code).name,
      revenue: row.revenue,
      orders: row.orders,
      aov: safeDivide(row.revenue, row.orders)
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const cityMap = new Map();
  orders.forEach((row) => {
    if (!row.city) return;
    const key = row.city.trim();
    if (!key) return;
    const entry = cityMap.get(key) || { city: key, revenue: 0, orders: 0 };
    entry.revenue += toNumber(row.order_total);
    entry.orders += 1;
    cityMap.set(key, entry);
  });

  const cityRows = Array.from(cityMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((row) => ({
      city: row.city,
      revenue: row.revenue,
      orders: row.orders,
      aov: safeDivide(row.revenue, row.orders)
    }));

  const minSegmentOrders = getMinSegmentOrders(totalOrders);

  const topCity = cityRows[0];
  const topCountryRow = countryRows[0];

  const reliableCity = cityRows.find((row) => row.orders >= minSegmentOrders) || null;
  const reliableCountry = countryRows.find((row) => row.orders >= minSegmentOrders) || null;

  const bestCustomerSegment = reliableCity
    ? { type: 'city', label: reliableCity.city, orders: reliableCity.orders }
    : (reliableCountry
      ? { type: 'country', label: reliableCountry.name, orders: reliableCountry.orders }
      : (topCountryRow ? { type: 'country', label: topCountryRow.name, orders: topCountryRow.orders } : null));

  const bestCustomerLabel = bestCustomerSegment?.label || null;
  const segmentOrders = bestCustomerSegment?.orders || 0;

  const topDay = timing.topDay.count ? timing.topDay : null;
  const topHour = timing.topHour.count ? timing.topHour : null;

  const confidence = scoreConfidence(segmentOrders);

  const hero = {
    title: bestCustomerLabel ? `Best customers: ${bestCustomerLabel}` : 'Customer insights are building',
    subtitle: topDay && topHour
      ? `Peak orders on ${DAY_NAMES[topDay.day]} ${describeDaypart(topHour.hour)}.`
      : `Window: ${startDate} → ${endDate}`,
    metricLabel: 'Share of orders',
    metricValue: segmentOrders && totalOrders ? safeDivide(segmentOrders, totalOrders) : 0,
    metricFormat: 'percent',
    confidence,
    sampleSize: segmentOrders || 0
  };

  const kpis = [
    { id: 'best-segment', label: 'Best Customers', value: bestCustomerLabel || '—', format: 'text' },
    { id: 'ltv90', label: '90-Day LTV', value: customerStats.avgLtv90 ?? avgOrderValue, format: 'currency' },
    { id: 'repeat-rate', label: 'Repeat Rate', value: customerStats.repeatRate, format: 'percent' },
    { id: 'discount-reliance', label: 'Discount Reliance', value: discountMetrics.discountRevenueShare, format: 'percent' },
    { id: 'refund-drag', label: 'Refund Drag', value: null, format: 'percent', hint: 'Refund data not connected' },
    { id: 'top-repeat', label: 'Top Repeat Path', value: repeatPaths[0] ? `${repeatPaths[0].from} → ${repeatPaths[0].to}` : '—', format: 'text' },
    { id: 'top-bundle', label: 'Top Bundle', value: bundles[0] ? `${bundles[0].pair[0]} + ${bundles[0].pair[1]}` : '—', format: 'text' }
  ];

  const insights = buildInsights({
    discountMetrics,
    repeatRate: customerStats.repeatRate,
    topDay,
    topHour,
    bundleTop: bundles[0],
    segmentLabel: metaSegment?.label,
    productShiftInsights
  });

  const windowLabel = params.startDate && params.endDate
    ? `${startDate} → ${endDate}`
    : `Last ${days} days`;

  return {
    updatedAt: new Date().toISOString(),
    window: {
      startDate,
      endDate,
      days,
      label: windowLabel
    },
    hero,
    kpis,
    insights,
    sections: {
      segments: {
        summary: bestCustomerLabel ? `Top customers: ${bestCustomerLabel}` : 'Segment rankings will appear once data flows in.',
        timing: {
          topDay: topDay ? DAY_NAMES[topDay.day] : null,
          topHour: topHour ? topHour.hour : null
        }
      },
      topProducts: {
        summary: topProducts.length ? 'Top products by revenue and order count.' : 'Top products will appear once line-item data is synced.',
        products: topProducts
      },
      cohorts: {
        summary: customerStats.customerCount
          ? `Tracking ${customerStats.customerCount} customers in this window.`
          : 'Customer-level data not available yet.',
        curve: [
          { horizon: '30d', value: customerStats.cohorts[0]?.ltv30 ?? avgOrderValue },
          { horizon: '60d', value: customerStats.cohorts[0]?.ltv60 ?? avgOrderValue },
          { horizon: '90d', value: customerStats.cohorts[0]?.ltv90 ?? avgOrderValue }
        ],
        cohorts: customerStats.cohorts
      },
      repeatPaths: {
        summary: repeatPaths.length ? 'Top next-purchase paths identified.' : 'Repeat paths need product-level data.',
        paths: repeatPaths
      },
      discountRefund: {
        summary: `Discounted orders represent ${(discountMetrics.discountRevenueShare * 100).toFixed(1)}% of revenue.`,
        metrics: {
          discountOrderRate: discountMetrics.discountOrderRate,
          discountRevenueShare: discountMetrics.discountRevenueShare,
          avgDiscountRate: discountMetrics.avgDiscountRate,
          avgDiscountedAov: discountMetrics.avgDiscountedAov,
          avgFullAov: discountMetrics.avgFullAov
        },
        discountSkus
      },
      bundles: {
        summary: bundles.length ? 'Frequent bundles detected.' : 'Bundle insights need product-level data.',
        bundles
      },
      activation: {
        summary: metaSegment ? 'Audience actions ready for activation.' : 'Connect Meta breakdowns to enable activation.',
        readySegments: [
          metaSegment ? { label: metaSegment.label, size: metaSegment.conversions, type: 'Meta breakdown' } : null,
          bestCustomerSegment ? { label: `${bestCustomerSegment.label} buyers`, size: bestCustomerSegment.orders, type: 'Geo' } : null
        ].filter(Boolean)
      }
    },
    dataQuality: {
      orders: totalOrders,
      revenue: totalRevenue,
      customers: customerStats.customerCount,
      hasItems: items.length > 0,
      hasMetaBreakdowns: Boolean(metaSegment),
      notes: [
        customerStats.customerCount ? null : 'Customer IDs missing for full repeat analysis.',
        items.length ? null : 'Line items not yet synced for bundles and paths.',
        metaSegment ? null : 'Meta age/gender breakdowns not available.',
        timing.timeZone ? `Order timing shown in ${timing.timeZone}.` : null
      ].filter(Boolean)
    }
  };
}
