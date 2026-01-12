import cron from 'node-cron';
import { getDb } from '../db/database.js';
import { generateCreativeFunnelSummary } from './openaiService.js';

const ISTANBUL_TIMEZONE = 'Europe/Istanbul';

const DEFAULT_PROMPTS = {
  analyze: 'Without ad-hoc reasoning and rigorous thinking anaylze these ads numbers and provide rigorous insights. Interpret the funnel numbers → diagnose what changed + why → give prioritized actions/tests. Keep verbosity low.',
  summarize: 'Show what changed and organize data in a readable meaningful way, to be comprehended at a glance. Keep verbosity low.'
};

const DEFAULT_VERBOSITY = {
  analyze: 'low',
  summarize: 'low'
};

const DEFAULT_STORES = ['vironax', 'shawq'];

const getIstanbulDateString = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ISTANBUL_TIMEZONE }).format(date);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getWeekRange = (endDateString) => {
  const endDate = new Date(`${endDateString}T00:00:00`);
  const startDate = addDays(endDate, -6);
  return {
    startDate: getIstanbulDateString(startDate),
    endDate: endDateString
  };
};

const coerceSettings = (row) => ({
  autoEnabled: row?.auto_enabled !== 0,
  analyzePrompt: row?.analyze_prompt || DEFAULT_PROMPTS.analyze,
  summarizePrompt: row?.summarize_prompt || DEFAULT_PROMPTS.summarize,
  analyzeVerbosity: row?.analyze_verbosity || DEFAULT_VERBOSITY.analyze,
  summarizeVerbosity: row?.summarize_verbosity || DEFAULT_VERBOSITY.summarize
});

export const getCreativeFunnelSummarySettings = (store) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM creative_funnel_summary_settings WHERE store = ?
  `).get(store);

  if (!row) {
    db.prepare(`
      INSERT INTO creative_funnel_summary_settings
      (store, auto_enabled, analyze_prompt, summarize_prompt, analyze_verbosity, summarize_verbosity)
      VALUES (?, 1, ?, ?, ?, ?)
    `).run(
      store,
      DEFAULT_PROMPTS.analyze,
      DEFAULT_PROMPTS.summarize,
      DEFAULT_VERBOSITY.analyze,
      DEFAULT_VERBOSITY.summarize
    );
    return {
      autoEnabled: true,
      analyzePrompt: DEFAULT_PROMPTS.analyze,
      summarizePrompt: DEFAULT_PROMPTS.summarize,
      analyzeVerbosity: DEFAULT_VERBOSITY.analyze,
      summarizeVerbosity: DEFAULT_VERBOSITY.summarize
    };
  }

  return coerceSettings(row);
};

export const updateCreativeFunnelSummarySettings = (store, updates = {}) => {
  const db = getDb();
  const existing = getCreativeFunnelSummarySettings(store);

  const next = {
    autoEnabled: updates.autoEnabled ?? existing.autoEnabled,
    analyzePrompt: updates.analyzePrompt ?? existing.analyzePrompt,
    summarizePrompt: updates.summarizePrompt ?? existing.summarizePrompt,
    analyzeVerbosity: updates.analyzeVerbosity ?? existing.analyzeVerbosity,
    summarizeVerbosity: updates.summarizeVerbosity ?? existing.summarizeVerbosity
  };

  db.prepare(`
    INSERT INTO creative_funnel_summary_settings
    (store, auto_enabled, analyze_prompt, summarize_prompt, analyze_verbosity, summarize_verbosity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store) DO UPDATE SET
      auto_enabled = excluded.auto_enabled,
      analyze_prompt = excluded.analyze_prompt,
      summarize_prompt = excluded.summarize_prompt,
      analyze_verbosity = excluded.analyze_verbosity,
      summarize_verbosity = excluded.summarize_verbosity,
      updated_at = datetime('now')
  `).run(
    store,
    next.autoEnabled ? 1 : 0,
    next.analyzePrompt,
    next.summarizePrompt,
    next.analyzeVerbosity,
    next.summarizeVerbosity
  );

  return next;
};

export const getLatestCreativeFunnelSummary = (store, mode) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM creative_funnel_summaries
    WHERE store = ? AND mode = ?
    ORDER BY datetime(generated_at) DESC
    LIMIT 1
  `).get(store, mode);

  if (!row || row.dismissed_at) return null;
  return row;
};

export const dismissCreativeFunnelSummary = (store, mode) => {
  const db = getDb();
  db.prepare(`
    UPDATE creative_funnel_summaries
    SET dismissed_at = datetime('now')
    WHERE id = (
      SELECT id FROM creative_funnel_summaries
      WHERE store = ? AND mode = ?
      ORDER BY datetime(generated_at) DESC
      LIMIT 1
    )
  `).run(store, mode);
};

export const saveCreativeFunnelSummary = ({
  store,
  mode,
  prompt,
  verbosity,
  content,
  model,
  startDate,
  endDate,
  source = 'manual',
  period = 'custom',
  generatedAt = new Date().toISOString()
}) => {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO creative_funnel_summaries
    (store, mode, prompt, verbosity, content, model, start_date, end_date, source, period, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    store,
    mode,
    prompt,
    verbosity,
    content,
    model,
    startDate,
    endDate,
    source,
    period,
    generatedAt
  );

  return result.lastInsertRowid;
};

const getDistinctStores = () => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT store FROM meta_daily_metrics
  `).all();
  const stores = rows.map(row => row.store).filter(Boolean);
  return stores.length > 0 ? stores : DEFAULT_STORES;
};

const hasDailySummaryForDate = (store, dateString) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1 FROM creative_funnel_summaries
    WHERE store = ? AND period = 'daily' AND end_date = ?
    LIMIT 1
  `).get(store, dateString);
  return Boolean(row);
};

const getTotalSpendForDate = (store, dateString) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE store = ? AND date = ?
  `).get(store, dateString);
  return Number(row?.spend || 0);
};

const hasMetricsForDate = (store, dateString) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(1) as total
    FROM meta_daily_metrics
    WHERE store = ? AND date = ?
  `).get(store, dateString);
  return Number(row?.total || 0) > 0;
};

const runSummaryForStore = async ({ store, mode, prompt, verbosity, startDate, endDate, source, period }) => {
  const result = await generateCreativeFunnelSummary({
    store,
    mode,
    prompt,
    verbosity,
    startDate,
    endDate
  });

  saveCreativeFunnelSummary({
    store,
    mode,
    prompt,
    verbosity,
    content: result.text,
    model: result.model,
    startDate,
    endDate,
    source,
    period,
    generatedAt: new Date().toISOString()
  });
};

const runDailySummaries = async () => {
  const today = getIstanbulDateString();
  const stores = getDistinctStores();
  await Promise.all(stores.map(async (store) => {
    const settings = getCreativeFunnelSummarySettings(store);
    if (!settings.autoEnabled) return;
    if (hasDailySummaryForDate(store, today)) return;

    await Promise.all([
      runSummaryForStore({
        store,
        mode: 'analyze',
        prompt: settings.analyzePrompt,
        verbosity: settings.analyzeVerbosity,
        startDate: today,
        endDate: today,
        source: 'auto',
        period: 'daily'
      }),
      runSummaryForStore({
        store,
        mode: 'summarize',
        prompt: settings.summarizePrompt,
        verbosity: settings.summarizeVerbosity,
        startDate: today,
        endDate: today,
        source: 'auto',
        period: 'daily'
      })
    ]);
  }));
};

const runWeeklySummaries = async () => {
  const endDate = getIstanbulDateString();
  const { startDate } = getWeekRange(endDate);
  const stores = getDistinctStores();
  await Promise.all(stores.map(async (store) => {
    const settings = getCreativeFunnelSummarySettings(store);
    if (!settings.autoEnabled) return;

    await Promise.all([
      runSummaryForStore({
        store,
        mode: 'analyze',
        prompt: settings.analyzePrompt,
        verbosity: settings.analyzeVerbosity,
        startDate,
        endDate,
        source: 'auto',
        period: 'weekly'
      }),
      runSummaryForStore({
        store,
        mode: 'summarize',
        prompt: settings.summarizePrompt,
        verbosity: settings.summarizeVerbosity,
        startDate,
        endDate,
        source: 'auto',
        period: 'weekly'
      })
    ]);
  }));
};

const checkSpendResetAndGenerate = async () => {
  const today = getIstanbulDateString();
  const yesterday = getIstanbulDateString(addDays(new Date(), -1));
  const stores = getDistinctStores();

  await Promise.all(stores.map(async (store) => {
    const settings = getCreativeFunnelSummarySettings(store);
    if (!settings.autoEnabled) return;
    if (hasDailySummaryForDate(store, yesterday)) return;

    const spendToday = getTotalSpendForDate(store, today);
    if (spendToday > 0) return;
    if (!hasMetricsForDate(store, yesterday)) return;

    await Promise.all([
      runSummaryForStore({
        store,
        mode: 'analyze',
        prompt: settings.analyzePrompt,
        verbosity: settings.analyzeVerbosity,
        startDate: yesterday,
        endDate: yesterday,
        source: 'auto',
        period: 'daily'
      }),
      runSummaryForStore({
        store,
        mode: 'summarize',
        prompt: settings.summarizePrompt,
        verbosity: settings.summarizeVerbosity,
        startDate: yesterday,
        endDate: yesterday,
        source: 'auto',
        period: 'daily'
      })
    ]);
  }));
};

export const scheduleCreativeFunnelSummaryJobs = () => {
  cron.schedule('59 23 * * *', () => {
    runDailySummaries().catch((error) => {
      console.error('[Creative Summary] Daily auto summary failed:', error.message);
    });
  }, { timezone: ISTANBUL_TIMEZONE });

  cron.schedule('59 23 * * 0', () => {
    runWeeklySummaries().catch((error) => {
      console.error('[Creative Summary] Weekly auto summary failed:', error.message);
    });
  }, { timezone: ISTANBUL_TIMEZONE });

  cron.schedule('10 * * * *', () => {
    checkSpendResetAndGenerate().catch((error) => {
      console.error('[Creative Summary] Spend reset check failed:', error.message);
    });
  }, { timezone: ISTANBUL_TIMEZONE });
};
