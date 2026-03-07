import { getDb } from '../db/database.js';

const SURVEY_TEMPLATE_STATUSES = new Set(['ready', 'active', 'paused']);
const SURVEY_CONSENT_MODES = new Set(['auto_link', 'ask_consent', 'response_only']);
const SURVEY_DELIVERY_TYPES = new Set(['storefront', 'return_visit', 'recovery', 'checkout_plus']);
const SURVEY_RESPONSE_TEXT_MAX_LENGTH = 1000;
const SURVEY_CHOICE_LABEL_MAX_LENGTH = 160;
const SURVEY_PAGE_PATH_MAX_LENGTH = 500;
const SURVEY_PAGE_URL_MAX_LENGTH = 1200;
const SURVEY_USER_ID_MAX_LENGTH = 120;
const SURVEY_ISSUE_KEY_MAX_LENGTH = 160;
const SURVEY_SOURCE_MAX_LENGTH = 80;
const SURVEY_SUMMARY_DEFAULT_LIMIT = 8;
const SURVEY_DEFAULT_LOOKBACK_DAYS = 30;
const SURVEY_RECENT_RESPONSE_LIMIT = 6;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SQLITE_DAY_END_SUFFIX_MS = (24 * 60 * 60 * 1000) - 1;

const SURVEY_TEMPLATES = [
  {
    key: 'payment_hesitation',
    version: 1,
    name: 'Payment hesitation',
    goal: 'Understand what blocks shoppers at the final payment decision.',
    triggerLabel: 'Reached payment or submitted payment info, then no purchase',
    deliveryLabel: 'Recovery or return visit',
    deliveryType: 'recovery',
    consentMode: 'auto_link',
    description: 'Use after a payment-step exit to separate payment failure from price, trust, or shipping concerns.',
    questionText: 'What stopped you from finishing your order today?',
    choices: [
      { key: 'payment_failed', label: 'Payment failed' },
      { key: 'shipping_cost', label: 'Shipping cost too high' },
      { key: 'price_surprise', label: 'Total price was higher than expected' },
      { key: 'trust_concern', label: 'I did not trust the checkout enough' },
      { key: 'need_more_time', label: 'I needed more time' },
      { key: 'other', label: 'Other' }
    ]
  },
  {
    key: 'checkout_friction',
    version: 1,
    name: 'Checkout friction',
    goal: 'Identify blockers in contact and shipping before payment.',
    triggerLabel: 'Checkout started, then exit before payment or purchase',
    deliveryLabel: 'Storefront or recovery',
    deliveryType: 'storefront',
    consentMode: 'auto_link',
    description: 'Use when shoppers start checkout but fail to progress to payment.',
    questionText: 'What made checkout difficult today?',
    choices: [
      { key: 'too_many_fields', label: 'Too many form fields' },
      { key: 'shipping_unclear', label: 'Shipping details were unclear' },
      { key: 'delivery_too_slow', label: 'Delivery felt too slow' },
      { key: 'discount_issue', label: 'Discount or code issue' },
      { key: 'technical_problem', label: 'Something felt broken' },
      { key: 'other', label: 'Other' }
    ]
  },
  {
    key: 'product_hesitation',
    version: 1,
    name: 'Product hesitation',
    goal: 'Learn why shoppers view products but do not move into cart.',
    triggerLabel: 'Product-view sessions with no add to cart or checkout',
    deliveryLabel: 'Storefront',
    deliveryType: 'storefront',
    consentMode: 'auto_link',
    description: 'Use on product pages when shoppers are engaged but undecided.',
    questionText: 'What held you back from adding this item to cart?',
    choices: [
      { key: 'price', label: 'Price felt too high' },
      { key: 'fit_or_size', label: 'Fit or size was unclear' },
      { key: 'not_enough_details', label: 'I needed more details' },
      { key: 'not_ready', label: 'I am not ready to buy yet' },
      { key: 'trust_or_quality', label: 'I was unsure about quality or trust' },
      { key: 'other', label: 'Other' }
    ]
  },
  {
    key: 'cart_hesitation',
    version: 1,
    name: 'Cart hesitation',
    goal: 'Understand why cart sessions stop before checkout.',
    triggerLabel: 'Cart viewed, then no checkout or purchase',
    deliveryLabel: 'Storefront',
    deliveryType: 'storefront',
    consentMode: 'auto_link',
    description: 'Use when cart totals are visible but shoppers do not continue.',
    questionText: 'What stopped you from continuing to checkout?',
    choices: [
      { key: 'shipping_cost', label: 'Shipping cost was too high' },
      { key: 'total_too_high', label: 'The total felt too high' },
      { key: 'wanted_to_compare', label: 'I wanted to compare options first' },
      { key: 'not_ready', label: 'I was not ready yet' },
      { key: 'technical_problem', label: 'Something in cart felt broken' },
      { key: 'other', label: 'Other' }
    ]
  },
  {
    key: 'technical_issue_followup',
    version: 1,
    name: 'Technical issue follow-up',
    goal: 'Confirm whether detected friction felt broken or confusing to shoppers.',
    triggerLabel: 'Confirmed or repeated technical / interaction issue detected',
    deliveryLabel: 'Storefront',
    deliveryType: 'storefront',
    consentMode: 'auto_link',
    description: 'Use after a confirmed or repeated dead click, rage click, or JS issue.',
    questionText: 'Did something on this page feel broken or confusing?',
    choices: [
      { key: 'felt_broken', label: 'Yes, something felt broken' },
      { key: 'felt_confusing', label: 'Yes, it felt confusing' },
      { key: 'worked_after_retry', label: 'It worked after I tried again' },
      { key: 'not_sure', label: 'I was not sure what would happen' },
      { key: 'other', label: 'Other' }
    ]
  },
  {
    key: 'return_visit_recovery',
    version: 1,
    name: 'Return-visit recovery',
    goal: 'Capture the reason a high-intent shopper left before converting and later returned.',
    triggerLabel: 'Repeat shopper returns after a high-intent abandonment',
    deliveryLabel: 'Return visit',
    deliveryType: 'return_visit',
    consentMode: 'auto_link',
    description: 'Use when a shopper comes back after a prior high-intent session with no purchase.',
    questionText: 'Last time you visited, what got in the way of finishing your order?',
    choices: [
      { key: 'needed_more_time', label: 'I needed more time' },
      { key: 'payment_or_checkout', label: 'Payment or checkout got in the way' },
      { key: 'price_or_shipping', label: 'Price or shipping stopped me' },
      { key: 'came_back_later', label: 'I planned to come back later' },
      { key: 'technical_problem', label: 'Something felt broken last time' },
      { key: 'other', label: 'Other' }
    ]
  }
];

const SURVEY_TEMPLATE_BY_KEY = new Map(SURVEY_TEMPLATES.map((template) => [template.key, template]));

function safeString(value, maxLength = 255) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeStore(store) {
  return safeString(store, 80) || 'shawq';
}

function normalizeSqliteDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseIsoDayToUtcMs(value) {
  const raw = safeString(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NaN;
  const timestamp = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function toSqliteUtcDateTime(ms) {
  if (!Number.isFinite(ms)) return null;
  return normalizeSqliteDateTime(new Date(ms));
}

function normalizeRange({ startDate, endDate } = {}) {
  const endMsRaw = parseIsoDayToUtcMs(endDate);
  const startMsRaw = parseIsoDayToUtcMs(startDate);
  const nowMs = Date.now();
  const fallbackEndMs = Number.isFinite(endMsRaw)
    ? endMsRaw
    : parseIsoDayToUtcMs(new Date(nowMs).toISOString().slice(0, 10));
  const endMs = Number.isFinite(fallbackEndMs) ? fallbackEndMs : nowMs;
  const startMs = Number.isFinite(startMsRaw)
    ? startMsRaw
    : endMs - ((SURVEY_DEFAULT_LOOKBACK_DAYS - 1) * MILLISECONDS_PER_DAY);
  const safeStartMs = Math.min(startMs, endMs);
  const safeEndMs = Math.max(startMs, endMs);
  return {
    startDate: new Date(safeStartMs).toISOString().slice(0, 10),
    endDate: new Date(safeEndMs).toISOString().slice(0, 10),
    startSql: toSqliteUtcDateTime(safeStartMs),
    endSqlExclusive: toSqliteUtcDateTime(safeEndMs + SQLITE_DAY_END_SUFFIX_MS + 1)
  };
}

function normalizeTemplateStatus(value) {
  const normalized = safeString(value, 32).toLowerCase();
  return SURVEY_TEMPLATE_STATUSES.has(normalized) ? normalized : 'ready';
}

function normalizeConsentMode(value) {
  const normalized = safeString(value, 32).toLowerCase();
  return SURVEY_CONSENT_MODES.has(normalized) ? normalized : 'auto_link';
}

function normalizeDeliveryType(value, fallback = 'storefront') {
  const normalized = safeString(value, 32).toLowerCase();
  return SURVEY_DELIVERY_TYPES.has(normalized) ? normalized : fallback;
}

function getTemplateDefinition(templateKey) {
  return SURVEY_TEMPLATE_BY_KEY.get(safeString(templateKey, 80));
}

function getTemplateConfigMap(db, store) {
  const rows = db.prepare(`
    SELECT
      template_key,
      status,
      consent_mode,
      delivery_type,
      question_text_override,
      choices_override_json,
      updated_at
    FROM si_survey_template_configs
    WHERE store = ?
  `).all(store);

  return new Map(rows.map((row) => [row.template_key, row]));
}

function getResponseStatsMap(db, store, range) {
  const rows = db.prepare(`
    SELECT
      template_key,
      COUNT(*) AS response_count,
      COUNT(DISTINCT CASE WHEN session_id IS NOT NULL AND session_id != '' THEN session_id END) AS linked_sessions,
      MAX(submitted_at) AS last_response_at
    FROM si_survey_responses
    WHERE store = ?
      AND submitted_at >= ?
      AND submitted_at < ?
    GROUP BY template_key
  `).all(store, range.startSql, range.endSqlExclusive);

  return new Map(rows.map((row) => [row.template_key, row]));
}

function getChoiceBreakdownMap(db, store, range) {
  const rows = db.prepare(`
    SELECT
      template_key,
      response_choice_key,
      response_choice_label,
      COUNT(*) AS responses
    FROM si_survey_responses
    WHERE store = ?
      AND submitted_at >= ?
      AND submitted_at < ?
      AND response_choice_key IS NOT NULL
      AND response_choice_key != ''
    GROUP BY template_key, response_choice_key, response_choice_label
  `).all(store, range.startSql, range.endSqlExclusive);

  const out = new Map();
  for (const row of rows) {
    const key = row.template_key;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({
      key: safeString(row.response_choice_key, 80),
      label: safeString(row.response_choice_label, SURVEY_CHOICE_LABEL_MAX_LENGTH),
      responses: Number(row.responses) || 0
    });
  }
  return out;
}

function getRecentResponseRows(db, store, range, limit) {
  const cappedLimit = Math.min(Math.max(Number(limit) || SURVEY_RECENT_RESPONSE_LIMIT, 1), 50);
  return db.prepare(`
    SELECT
      template_key,
      response_choice_label,
      response_text,
      session_id,
      shopper_number,
      issue_key,
      page_path,
      submitted_at
    FROM si_survey_responses
    WHERE store = ?
      AND submitted_at >= ?
      AND submitted_at < ?
    ORDER BY submitted_at DESC, id DESC
    LIMIT ?
  `).all(store, range.startSql, range.endSqlExclusive, cappedLimit);
}

function buildTemplateRecommendations(db, store, range) {
  const recommendationMap = new Map();

  const sessionsRow = db.prepare(`
    SELECT
      SUM(CASE WHEN purchase_at IS NULL AND lower(COALESCE(last_checkout_step, '')) = 'payment' THEN 1 ELSE 0 END) AS payment_hesitation,
      SUM(CASE WHEN purchase_at IS NULL AND checkout_started_at IS NOT NULL AND lower(COALESCE(last_checkout_step, '')) NOT IN ('payment', 'thank_you') THEN 1 ELSE 0 END) AS checkout_friction,
      SUM(CASE WHEN purchase_at IS NULL AND atc_at IS NOT NULL AND checkout_started_at IS NULL THEN 1 ELSE 0 END) AS cart_hesitation,
      SUM(CASE WHEN purchase_at IS NULL AND last_product_id IS NOT NULL AND atc_at IS NULL AND checkout_started_at IS NULL THEN 1 ELSE 0 END) AS product_hesitation
    FROM si_sessions
    WHERE store = ?
      AND started_at >= ?
      AND started_at < ?
  `).get(store, range.startSql, range.endSqlExclusive);

  const repeatedReturnVisitors = db.prepare(`
    SELECT COUNT(*) AS shoppers
    FROM (
      SELECT shopper_number
      FROM si_sessions
      WHERE store = ?
        AND started_at >= ?
        AND started_at < ?
        AND purchase_at IS NULL
        AND shopper_number IS NOT NULL
      GROUP BY shopper_number
      HAVING COUNT(*) >= 2
    )
  `).get(store, range.startSql, range.endSqlExclusive);

  const technicalIssueRow = db.prepare(`
    SELECT
      COALESCE(SUM(sessions_affected), 0) AS affected_sessions,
      COUNT(DISTINCT issue_key) AS issue_clusters
    FROM si_issue_daily_stats
    WHERE store = ?
      AND date >= ?
      AND date <= ?
      AND sessions_affected > 0
  `).get(store, range.startDate, range.endDate);

  const counts = {
    payment_hesitation: Number(sessionsRow?.payment_hesitation) || 0,
    checkout_friction: Number(sessionsRow?.checkout_friction) || 0,
    cart_hesitation: Number(sessionsRow?.cart_hesitation) || 0,
    product_hesitation: Number(sessionsRow?.product_hesitation) || 0,
    return_visit_recovery: Number(repeatedReturnVisitors?.shoppers) || 0,
    technical_issue_followup: Number(technicalIssueRow?.affected_sessions) || 0
  };

  const reasons = {
    payment_hesitation: 'Payment-step exits are present in this range.',
    checkout_friction: 'Checkout starts are dropping before payment in this range.',
    cart_hesitation: 'Cart sessions are stopping before checkout in this range.',
    product_hesitation: 'Product-view sessions are ending before cart in this range.',
    return_visit_recovery: 'Repeat non-purchasing shoppers returned in this range.',
    technical_issue_followup: 'Repeated issue clusters are present in this range.'
  };

  for (const [templateKey, count] of Object.entries(counts)) {
    recommendationMap.set(templateKey, {
      recommended: count > 0,
      affectedSessions: count,
      reason: count > 0 ? reasons[templateKey] : ''
    });
  }

  return recommendationMap;
}

function mergeTemplateWithState(template, configRow, statsRow, choiceRows, recommendation) {
  const choices = Array.isArray(choiceRows) ? [...choiceRows].sort((a, b) => b.responses - a.responses) : [];
  const topChoice = choices[0] || null;
  const choicesOverride = safeJsonParse(configRow?.choices_override_json);
  return {
    key: template.key,
    version: template.version,
    name: template.name,
    goal: template.goal,
    description: template.description,
    triggerLabel: template.triggerLabel,
    deliveryLabel: template.deliveryLabel,
    deliveryType: normalizeDeliveryType(configRow?.delivery_type, template.deliveryType),
    consentMode: normalizeConsentMode(configRow?.consent_mode || template.consentMode),
    questionText: safeString(configRow?.question_text_override, 500) || template.questionText,
    choices: Array.isArray(choicesOverride) && choicesOverride.length ? choicesOverride : template.choices,
    status: normalizeTemplateStatus(configRow?.status),
    responseCount: Number(statsRow?.response_count) || 0,
    linkedSessions: Number(statsRow?.linked_sessions) || 0,
    lastResponseAt: statsRow?.last_response_at || null,
    topChoice: topChoice
      ? { label: topChoice.label || topChoice.key, responses: topChoice.responses }
      : null,
    recommendation: recommendation || { recommended: false, affectedSessions: 0, reason: '' },
    configuredAt: configRow?.updated_at || null
  };
}

function inferLinkConsent(requestedConsent, consentMode) {
  if (typeof requestedConsent === 'boolean') return requestedConsent;
  if (typeof requestedConsent === 'number') return requestedConsent === 1;
  const raw = safeString(requestedConsent, 16).toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
  if (consentMode === 'response_only') return false;
  if (consentMode === 'ask_consent') return false;
  return true;
}

function findLinkedSession(db, store, sessionId, clientId) {
  const normalizedSessionId = safeString(sessionId, 160);
  const normalizedClientId = safeString(clientId, 160);

  if (normalizedSessionId) {
    const bySession = db.prepare(`
      SELECT *
      FROM si_sessions
      WHERE store = ? AND session_id = ?
      LIMIT 1
    `).get(store, normalizedSessionId);
    if (bySession) return bySession;
  }

  if (!normalizedClientId) return null;
  return db.prepare(`
    SELECT *
    FROM si_sessions
    WHERE store = ? AND client_id = ?
    ORDER BY COALESCE(last_event_at, started_at, created_at) DESC, id DESC
    LIMIT 1
  `).get(store, normalizedClientId) || null;
}

function findLatestSessionEvent(db, store, sessionId) {
  const normalizedSessionId = safeString(sessionId, 160);
  if (!normalizedSessionId) return null;
  return db.prepare(`
    SELECT
      page_url,
      page_path,
      checkout_token,
      device_type,
      device_os,
      country_code,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term
    FROM si_events
    WHERE store = ?
      AND session_id = ?
    ORDER BY COALESCE(event_ts, created_at) DESC, id DESC
    LIMIT 1
  `).get(store, normalizedSessionId) || null;
}

function safeMetadataJson(value) {
  if (value == null) return null;
  try {
    const raw = JSON.stringify(value);
    if (!raw || raw === '{}' || raw === '[]') return null;
    return raw.length > 4000 ? raw.slice(0, 4000) : raw;
  } catch (_error) {
    return null;
  }
}

export function listSessionIntelligenceSurveyTemplates({ store, startDate, endDate, activeOnly = false } = {}) {
  const db = getDb();
  const normalizedStore = normalizeStore(store);
  const range = normalizeRange({ startDate, endDate });
  const configMap = getTemplateConfigMap(db, normalizedStore);
  const statsMap = getResponseStatsMap(db, normalizedStore, range);
  const choiceMap = getChoiceBreakdownMap(db, normalizedStore, range);
  const recommendationMap = buildTemplateRecommendations(db, normalizedStore, range);

  const templates = SURVEY_TEMPLATES
    .map((template) => mergeTemplateWithState(
      template,
      configMap.get(template.key),
      statsMap.get(template.key),
      choiceMap.get(template.key),
      recommendationMap.get(template.key)
    ))
    .filter((template) => (activeOnly ? template.status === 'active' : true))
    .sort((a, b) => {
      const recommendedDelta = Number(Boolean(b.recommendation?.recommended)) - Number(Boolean(a.recommendation?.recommended));
      if (recommendedDelta !== 0) return recommendedDelta;
      return a.name.localeCompare(b.name);
    });

  return {
    success: true,
    data: {
      store: normalizedStore,
      range,
      templates
    }
  };
}

export function upsertSessionIntelligenceSurveyTemplateConfig({
  store,
  templateKey,
  status,
  consentMode,
  deliveryType,
  questionText,
  choices
} = {}) {
  const db = getDb();
  const normalizedStore = normalizeStore(store);
  const template = getTemplateDefinition(templateKey);
  if (!template) {
    return { success: false, error: 'Unknown survey template key' };
  }

  const normalizedStatus = normalizeTemplateStatus(status);
  const normalizedConsentMode = normalizeConsentMode(consentMode || template.consentMode);
  const normalizedDeliveryType = normalizeDeliveryType(deliveryType, template.deliveryType);
  const questionTextOverride = safeString(questionText, 500) || null;
  const choicesJsonOverride = Array.isArray(choices) && choices.length
    ? JSON.stringify(choices)
    : null;

  db.prepare(`
    INSERT INTO si_survey_template_configs (
      store,
      template_key,
      status,
      consent_mode,
      delivery_type,
      question_text_override,
      choices_override_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store, template_key) DO UPDATE SET
      status = excluded.status,
      consent_mode = excluded.consent_mode,
      delivery_type = excluded.delivery_type,
      question_text_override = excluded.question_text_override,
      choices_override_json = excluded.choices_override_json,
      updated_at = excluded.updated_at
  `).run(
    normalizedStore,
    template.key,
    normalizedStatus,
    normalizedConsentMode,
    normalizedDeliveryType,
    questionTextOverride,
    choicesJsonOverride
  );

  const result = listSessionIntelligenceSurveyTemplates({ store: normalizedStore });
  return {
    success: true,
    data: result.data.templates.find((item) => item.key === template.key) || null
  };
}

export function recordSessionIntelligenceSurveyResponse({ store, payload, source = 'storefront' } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'Invalid survey payload' };
  }

  const db = getDb();
  const normalizedStore = normalizeStore(store || payload.store);
  const template = getTemplateDefinition(payload.templateKey || payload.template_key);
  if (!template) {
    return { success: false, error: 'Unknown survey template key' };
  }

  const configMap = getTemplateConfigMap(db, normalizedStore);
  const config = configMap.get(template.key) || null;
  const consentMode = normalizeConsentMode(config?.consent_mode || template.consentMode);
  const linkConsent = inferLinkConsent(payload.linkConsent ?? payload.link_consent, consentMode);
  const deliveryType = normalizeDeliveryType(payload.deliveryType || payload.delivery_type || config?.delivery_type, template.deliveryType);
  const submittedAt = normalizeSqliteDateTime(payload.submittedAt || payload.submitted_at || new Date());
  const responseText = safeString(payload.responseText || payload.response_text, SURVEY_RESPONSE_TEXT_MAX_LENGTH) || null;
  const choiceKey = safeString(payload.responseChoiceKey || payload.response_choice_key, 80) || null;
  const templateChoices = Array.isArray(template.choices) ? template.choices : [];
  const choiceDefinition = templateChoices.find((choice) => choice.key === choiceKey) || null;
  const responseChoiceLabel = safeString(
    payload.responseChoiceLabel || payload.response_choice_label || choiceDefinition?.label,
    SURVEY_CHOICE_LABEL_MAX_LENGTH
  ) || null;

  if (!choiceKey && !responseText) {
    return { success: false, error: 'Missing survey response content' };
  }

  const requestedSessionId = safeString(payload.sessionId || payload.session_id, 160) || null;
  const requestedClientId = safeString(payload.clientId || payload.client_id, 160) || null;
  const userId = safeString(payload.userId || payload.user_id, SURVEY_USER_ID_MAX_LENGTH) || null;
  const linkedSession = linkConsent ? findLinkedSession(db, normalizedStore, requestedSessionId, requestedClientId) : null;
  const latestEvent = linkedSession?.session_id ? findLatestSessionEvent(db, normalizedStore, linkedSession.session_id) : null;

  const sessionId = linkConsent ? safeString(linkedSession?.session_id || requestedSessionId, 160) || null : null;
  const clientId = linkConsent ? safeString(linkedSession?.client_id || requestedClientId, 160) || null : null;
  const shopperNumber = linkConsent ? (Number(linkedSession?.shopper_number) || null) : null;
  const issueKey = linkConsent ? (safeString(payload.issueKey || payload.issue_key, SURVEY_ISSUE_KEY_MAX_LENGTH) || null) : null;
  const pageUrl = safeString(payload.pageUrl || payload.page_url || latestEvent?.page_url, SURVEY_PAGE_URL_MAX_LENGTH) || null;
  const pagePath = safeString(payload.pagePath || payload.page_path || latestEvent?.page_path || linkedSession?.entry_page_path, SURVEY_PAGE_PATH_MAX_LENGTH) || null;
  const checkoutToken = safeString(payload.checkoutToken || payload.checkout_token || latestEvent?.checkout_token || linkedSession?.last_checkout_token, 160) || null;
  const deviceType = safeString(payload.deviceType || payload.device_type || latestEvent?.device_type || linkedSession?.last_device_type, 40) || null;
  const deviceOs = safeString(payload.deviceOs || payload.device_os || latestEvent?.device_os || linkedSession?.last_device_os, 40) || null;
  const countryCode = safeString(payload.countryCode || payload.country_code || latestEvent?.country_code || linkedSession?.last_country_code, 8).toUpperCase() || null;
  const utmSource = safeString(payload.utmSource || payload.utm_source || latestEvent?.utm_source || linkedSession?.entry_utm_source, 120) || null;
  const utmMedium = safeString(payload.utmMedium || payload.utm_medium || latestEvent?.utm_medium || linkedSession?.entry_utm_medium, 120) || null;
  const utmCampaign = safeString(payload.utmCampaign || payload.utm_campaign || latestEvent?.utm_campaign || linkedSession?.entry_utm_campaign, 240) || null;
  const utmContent = safeString(payload.utmContent || payload.utm_content || latestEvent?.utm_content, 240) || null;
  const utmTerm = safeString(payload.utmTerm || payload.utm_term || latestEvent?.utm_term, 240) || null;
  const metadataJson = safeMetadataJson(payload.metadata || payload.meta || null);

  db.prepare(`
    INSERT INTO si_survey_responses (
      store,
      template_key,
      template_version,
      source,
      delivery_type,
      consent_mode,
      link_consent,
      session_id,
      shopper_number,
      client_id,
      user_id,
      issue_key,
      page_url,
      page_path,
      checkout_token,
      device_type,
      device_os,
      country_code,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      response_choice_key,
      response_choice_label,
      response_text,
      metadata_json,
      submitted_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    normalizedStore,
    template.key,
    template.version,
    safeString(source || payload.source, SURVEY_SOURCE_MAX_LENGTH) || 'storefront',
    deliveryType,
    consentMode,
    linkConsent ? 1 : 0,
    sessionId,
    shopperNumber,
    clientId,
    linkConsent ? userId : null,
    issueKey,
    pageUrl,
    pagePath,
    checkoutToken,
    deviceType,
    deviceOs,
    countryCode,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    choiceKey,
    responseChoiceLabel,
    responseText,
    metadataJson,
    submittedAt
  );

  return {
    success: true,
    data: {
      store: normalizedStore,
      templateKey: template.key,
      linked: Boolean(linkConsent && sessionId),
      linkConsent,
      sessionId,
      shopperNumber,
      submittedAt
    }
  };
}

export function getSessionIntelligenceSurveySummary({ store, startDate, endDate, limit = SURVEY_SUMMARY_DEFAULT_LIMIT } = {}) {
  const db = getDb();
  const normalizedStore = normalizeStore(store);
  const range = normalizeRange({ startDate, endDate });
  const templateList = listSessionIntelligenceSurveyTemplates({
    store: normalizedStore,
    startDate: range.startDate,
    endDate: range.endDate
  }).data.templates;
  const cappedLimit = Math.min(Math.max(Number(limit) || SURVEY_SUMMARY_DEFAULT_LIMIT, 1), 20);

  const rows = templateList
    .filter((template) => template.responseCount > 0)
    .sort((a, b) => b.responseCount - a.responseCount)
    .slice(0, cappedLimit)
    .map((template) => ({
      templateKey: template.key,
      templateName: template.name,
      responseCount: template.responseCount,
      linkedSessions: template.linkedSessions,
      lastResponseAt: template.lastResponseAt,
      topChoice: template.topChoice,
      status: template.status
    }));

  const totalsRow = db.prepare(`
    SELECT
      COUNT(*) AS responses,
      COUNT(DISTINCT CASE WHEN session_id IS NOT NULL AND session_id != '' THEN session_id END) AS linked_sessions,
      COUNT(DISTINCT template_key) AS templates_with_responses
    FROM si_survey_responses
    WHERE store = ?
      AND submitted_at >= ?
      AND submitted_at < ?
  `).get(normalizedStore, range.startSql, range.endSqlExclusive);

  const recentResponses = getRecentResponseRows(db, normalizedStore, range, SURVEY_RECENT_RESPONSE_LIMIT).map((row) => ({
    templateKey: row.template_key,
    templateName: getTemplateDefinition(row.template_key)?.name || row.template_key,
    responseChoiceLabel: safeString(row.response_choice_label, SURVEY_CHOICE_LABEL_MAX_LENGTH) || null,
    responseText: safeString(row.response_text, SURVEY_RESPONSE_TEXT_MAX_LENGTH) || null,
    sessionId: row.session_id || null,
    shopperNumber: Number(row.shopper_number) || null,
    issueKey: row.issue_key || null,
    pagePath: row.page_path || null,
    submittedAt: row.submitted_at || null
  }));

  return {
    success: true,
    data: {
      store: normalizedStore,
      range,
      totals: {
        responses: Number(totalsRow?.responses) || 0,
        linkedSessions: Number(totalsRow?.linked_sessions) || 0,
        templatesWithResponses: Number(totalsRow?.templates_with_responses) || 0
      },
      rows,
      recentResponses
    }
  };
}
