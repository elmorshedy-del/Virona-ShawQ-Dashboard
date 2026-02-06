const DEFAULT_NON_REVENUE_KEYWORDS = [
  'gift',
  'free gift',
  'complimentary',
  'sample',
  'tester',
  'giveaway',
  'bonus item',
  'promo item',
  'reward item'
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseKeywordCsv(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeLookupKey(value) {
  return normalizeText(String(value || ''))
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function parseKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return parseKeywordCsv(value);
  }
  return [];
}

function parseKeywordMap(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed)
      .map(([key, value]) => [normalizeLookupKey(key), parseKeywordList(value)])
      .filter(([key, value]) => key && value.length);
    return Object.fromEntries(entries);
  } catch (error) {
    return {};
  }
}

export function resolveNonRevenueKeywords({ account = null, store = null, keywords = null } = {}) {
  const explicitKeywords = parseKeywordList(keywords);
  if (explicitKeywords.length) return explicitKeywords;

  const accountMap = parseKeywordMap(process.env.NON_REVENUE_ITEM_KEYWORDS_BY_ACCOUNT);
  const storeMap = parseKeywordMap(process.env.NON_REVENUE_ITEM_KEYWORDS_BY_STORE);

  const accountKey = normalizeLookupKey(account);
  if (accountKey && accountMap[accountKey]?.length) {
    return accountMap[accountKey];
  }

  const storeKey = normalizeLookupKey(store);
  if (storeKey && storeMap[storeKey]?.length) {
    return storeMap[storeKey];
  }

  const fromEnv = parseKeywordCsv(process.env.NON_REVENUE_ITEM_KEYWORDS);
  if (fromEnv.length) return fromEnv;

  return DEFAULT_NON_REVENUE_KEYWORDS;
}

function getActiveKeywords(customKeywords = null) {
  return resolveNonRevenueKeywords({ keywords: customKeywords });
}

function findMatchedKeyword(text, keywords) {
  if (!text || !keywords.length) return null;
  return keywords.find((keyword) => text.includes(keyword)) || null;
}

function hasExplicitGiftFlag(item) {
  const candidates = [
    item?.is_gift,
    item?.isGift,
    item?.gift,
    item?.free_gift,
    item?.is_free,
    item?.non_revenue
  ];
  return candidates.some((entry) => entry === true || entry === 1 || entry === '1');
}

export function classifyNonRevenueLineItem(item, options = {}) {
  const keywords = getActiveKeywords(options.keywords);
  const quantity = Math.max(1, toNumber(item?.quantity || 1));
  const unitPrice = toNumber(item?.price);
  const discount = Math.max(0, toNumber(item?.discount));
  const gross = Math.max(0, unitPrice * quantity);
  const net = Math.max(0, gross - discount);

  const text = normalizeText(
    [
      item?.title,
      item?.name,
      item?.sku,
      item?.variant_title,
      item?.vendor
    ]
      .filter(Boolean)
      .join(' ')
  );

  const matchedKeyword = findMatchedKeyword(text, keywords);
  const reasons = [];

  if (hasExplicitGiftFlag(item)) reasons.push('explicit_flag');
  if (matchedKeyword) reasons.push(`keyword:${matchedKeyword}`);
  if (gross <= 0) reasons.push('zero_price');
  if (net <= 0) reasons.push('zero_net');

  const exclude = Boolean(
    reasons.includes('explicit_flag') ||
    matchedKeyword ||
    net <= 0
  );

  return {
    exclude,
    gross,
    net,
    reasons,
    reason: exclude ? reasons.join('|') : null
  };
}

export function classifyNonRevenueOrder(order, lineClassifications = [], options = {}) {
  const keywords = getActiveKeywords(options.keywords);
  const orderTotal = toNumber(order?.order_total);
  const subtotal = toNumber(order?.subtotal);
  const allLinesExcluded = lineClassifications.length > 0 && lineClassifications.every((line) => line?.exclude);
  const hasPositiveRevenueLine = lineClassifications.some((line) => !line?.exclude && (line?.net || 0) > 0);

  const orderText = normalizeText([order?.note, order?.tags].filter(Boolean).join(' '));
  const matchedKeyword = findMatchedKeyword(orderText, keywords);

  const reasons = [];
  if (allLinesExcluded) reasons.push('all_items_non_revenue');
  if (!hasPositiveRevenueLine && orderTotal <= 0 && subtotal <= 0) reasons.push('non_positive_order_total');
  if (matchedKeyword && orderTotal <= 0) reasons.push(`keyword:${matchedKeyword}`);

  const exclude = reasons.length > 0 && !hasPositiveRevenueLine;

  return {
    exclude,
    reasons,
    reason: exclude ? reasons.join('|') : null
  };
}
