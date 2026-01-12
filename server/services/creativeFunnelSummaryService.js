import cron from 'node-cron';
import { getDb } from '../db/database.js';
import { analyzeQuestion, summarizeData } from './openaiService.js';

const TIMEZONE = 'Etc/GMT-3';
const STORES = ['vironax', 'shawq'];
const DEFAULT_PROMPT = 'Without ad-hoc reasoning and rigorous thinking anaylze these ads numbers and provide rigorous insights';
const DEFAULT_VERBOSITY = 'low';
const DEFAULT_MODE = 'analyze';
const DEFAULT_AUTO_ENABLED = 1;

const getDateInTimeZone = (date, timeZone = TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
};

const addDays = (dateString, offsetDays) => {
  const base = new Date(`${dateString}T00:00:00`);
  base.setDate(base.getDate() + offsetDays);
  return getDateInTimeZone(base, TIMEZONE);
};

const buildModeInstructions = (mode, verbosity) => {
  if (mode === 'summarize') {
    return [
      'Show what changed and organize data in a readable meaningful way, to be comprehended at a glance.',
      'Effort: medium.',
      `Verbosity: ${verbosity}.`,
      verbosity === 'low'
        ? 'Keep it concise and scannable.'
        : 'Use slightly more detail, but stay focused.'
    ].join(' ');
  }

  return [
    'Interpret the funnel numbers, diagnose what changed + why, and give prioritized actions/tests.',
    `Verbosity: ${verbosity}.`,
    verbosity === 'low'
      ? 'Keep it short and prioritized.'
      : 'Provide medium detail with clear priorities.'
  ].join(' ');
};

const buildSummaryQuestion = ({ prompt, mode, verbosity }) => {
  const basePrompt = (prompt || DEFAULT_PROMPT).trim();
  const instructions = buildModeInstructions(mode, verbosity);
  return `${basePrompt}\n\n${instructions}`;
};

const ensureSettings = (store) => {
  const db = getDb();
  const existing = db.prepare(`
    SELECT store, prompt, auto_enabled, verbosity, mode
    FROM creative_funnel_summary_settings
    WHERE store = ?
  `).get(store);

  if (existing) return existing;

  db.prepare(`
    INSERT INTO creative_funnel_summary_settings (store, prompt, auto_enabled, verbosity, mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(store, DEFAULT_PROMPT, DEFAULT_AUTO_ENABLED, DEFAULT_VERBOSITY, DEFAULT_MODE);

  return {
    store,
    prompt: DEFAULT_PROMPT,
    auto_enabled: DEFAULT_AUTO_ENABLED,
    verbosity: DEFAULT_VERBOSITY,
    mode: DEFAULT_MODE
  };
};

const updateSettings = (store, updates = {}) => {
  const db = getDb();
  const current = ensureSettings(store);
  const resolvedAutoEnabled = typeof updates.auto_enabled === 'boolean'
    ? (updates.auto_enabled ? 1 : 0)
    : (Number.isFinite(updates.auto_enabled) ? updates.auto_enabled : current.auto_enabled);
  const next = {
    prompt: updates.prompt ?? current.prompt,
    auto_enabled: resolvedAutoEnabled,
    verbosity: updates.verbosity ?? current.verbosity,
    mode: updates.mode ?? current.mode
  };

  db.prepare(`
    UPDATE creative_funnel_summary_settings
    SET prompt = ?, auto_enabled = ?, verbosity = ?, mode = ?, updated_at = datetime('now')
    WHERE store = ?
  `).run(next.prompt, next.auto_enabled, next.verbosity, next.mode, store);

  return { store, ...next };
};

const getSummaries = (store) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT *
    FROM creative_funnel_summaries
    WHERE store = ?
    ORDER BY generated_at DESC
  `).all(store);

  const summaries = {};
  rows.forEach((row) => {
    if (!summaries[row.mode]) {
      summaries[row.mode] = row;
    }
  });
  return summaries;
};

const saveSummary = ({
  store,
  mode,
  prompt,
  verbosity,
  content,
  periodStart,
  periodEnd,
  periodType,
  source
}) => {
  const db = getDb();
  db.prepare(`
    DELETE FROM creative_funnel_summaries
    WHERE store = ? AND mode = ?
  `).run(store, mode);

  db.prepare(`
    INSERT INTO creative_funnel_summaries (
      store, mode, prompt, verbosity, content, period_start, period_end, period_type, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(store, mode, prompt, verbosity, content, periodStart, periodEnd, periodType, source);
};

const clearSummary = (store, mode) => {
  const db = getDb();
  db.prepare(`
    DELETE FROM creative_funnel_summaries
    WHERE store = ? AND mode = ?
  `).run(store, mode);
};

const generateSummary = async ({
  store,
  mode,
  prompt,
  verbosity,
  startDate,
  endDate,
  periodType,
  source
}) => {
  const question = buildSummaryQuestion({ prompt, mode, verbosity });
  const generator = mode === 'summarize' ? summarizeData : analyzeQuestion;
  const result = await generator(question, store, [], startDate, endDate);
  const content = result?.text || '';

  if (content) {
    saveSummary({
      store,
      mode,
      prompt,
      verbosity,
      content,
      periodStart: startDate,
      periodEnd: endDate,
      periodType,
      source
    });
  }

  return content;
};

const buildDailyRange = (dateString) => ({
  startDate: dateString,
  endDate: dateString
});

const buildWeeklyRange = (endDate) => ({
  startDate: addDays(endDate, -6),
  endDate
});

const shouldGenerateForSpendReset = (store, today, yesterday) => {
  const db = getDb();
  const todayStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(spend), 0) as spend
    FROM meta_daily_metrics
    WHERE store = ? AND date = ?
  `).get(store, today);
  const yesterdayStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(spend), 0) as spend
    FROM meta_daily_metrics
    WHERE store = ? AND date = ?
  `).get(store, yesterday);

  if (!todayStats?.count || Number(todayStats.spend) !== 0) return false;
  if (!yesterdayStats?.count) return false;

  const existing = db.prepare(`
    SELECT COUNT(*) as count
    FROM creative_funnel_summaries
    WHERE store = ? AND period_end = ? AND period_type = 'daily'
  `).get(store, yesterday);

  return (existing?.count || 0) === 0;
};

const generateDailySummaries = async (dateString, source = 'auto-daily', stores = STORES) => {
  for (const store of stores) {
    const settings = ensureSettings(store);
    if (!settings.auto_enabled) continue;
    const range = buildDailyRange(dateString);

    await Promise.all(['analyze', 'summarize'].map(mode => generateSummary({
      store,
      mode,
      prompt: settings.prompt,
      verbosity: settings.verbosity,
      startDate: range.startDate,
      endDate: range.endDate,
      periodType: 'daily',
      source
    })));
  }
};

const generateWeeklySummaries = async (endDate, source = 'auto-weekly', stores = STORES) => {
  for (const store of stores) {
    const settings = ensureSettings(store);
    if (!settings.auto_enabled) continue;
    const range = buildWeeklyRange(endDate);

    await Promise.all(['analyze', 'summarize'].map(mode => generateSummary({
      store,
      mode,
      prompt: settings.prompt,
      verbosity: settings.verbosity,
      startDate: range.startDate,
      endDate: range.endDate,
      periodType: 'weekly',
      source
    })));
  }
};

const checkSpendResetAndGenerate = async () => {
  const today = getDateInTimeZone(new Date(), TIMEZONE);
  const yesterday = addDays(today, -1);

  for (const store of STORES) {
    const settings = ensureSettings(store);
    if (!settings.auto_enabled) continue;
    if (!shouldGenerateForSpendReset(store, today, yesterday)) continue;

    await generateDailySummaries(yesterday, 'auto-spend-reset', [store]);
  }
};

const startCreativeFunnelSummaryJobs = () => {
  cron.schedule('59 23 * * *', async () => {
    const today = getDateInTimeZone(new Date(), TIMEZONE);
    await generateDailySummaries(today, 'auto-daily');
  }, { timezone: TIMEZONE });

  cron.schedule('59 23 * * 0', async () => {
    const endDate = getDateInTimeZone(new Date(), TIMEZONE);
    await generateWeeklySummaries(endDate, 'auto-weekly');
  }, { timezone: TIMEZONE });

  setInterval(() => {
    checkSpendResetAndGenerate().catch((error) => {
      console.error('[Creative Summary] Spend reset check failed:', error);
    });
  }, 60 * 60 * 1000);
};

export {
  DEFAULT_PROMPT,
  DEFAULT_VERBOSITY,
  DEFAULT_MODE,
  ensureSettings,
  updateSettings,
  getSummaries,
  saveSummary,
  clearSummary,
  buildSummaryQuestion,
  generateSummary,
  startCreativeFunnelSummaryJobs
};
