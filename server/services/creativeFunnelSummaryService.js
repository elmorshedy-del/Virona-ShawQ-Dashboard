import { getDb } from '../db/database.js';
import { analyzeQuestionStream, summarizeDataStream } from './openaiService.js';

const DEFAULT_ANALYZE_PROMPT = 'Without ad-hoc reasoning and rigorous thinking anaylze these ads numbers and provide rigorous insights';
const DEFAULT_SUMMARIZE_PROMPT = 'Show what changed and organize data in a readable meaningful way, to be comprehended at a glance';
const DEFAULT_VERBOSITY = 'low';
const AI_MODEL = 'gpt-5.1';
const AI_EFFORT = 'medium';
const TIMEZONE = 'Europe/Istanbul';
const STORES = ['vironax', 'shawq'];

const toGmt3DateString = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);

const addDays = (dateString, offset) => {
  const base = new Date(`${dateString}T00:00:00+03:00`);
  base.setDate(base.getDate() + offset);
  return base.toISOString().slice(0, 10);
};

const getDailyRange = () => {
  const day = toGmt3DateString();
  return { startDate: day, endDate: day };
};

const getWeeklyRange = () => {
  const day = toGmt3DateString();
  const startDate = addDays(day, -6);
  return { startDate, endDate: day };
};

const ensureSettings = (store) => {
  const db = getDb();
  const existing = db.prepare(`
    SELECT * FROM creative_funnel_summary_settings WHERE store = ?
  `).get(store);

  if (existing) {
    return existing;
  }

  db.prepare(`
    INSERT INTO creative_funnel_summary_settings (
      store, auto_generate, analyze_prompt, summarize_prompt, analyze_verbosity, summarize_verbosity
    ) VALUES (?, 1, ?, ?, ?, ?)
  `).run(store, DEFAULT_ANALYZE_PROMPT, DEFAULT_SUMMARIZE_PROMPT, DEFAULT_VERBOSITY, DEFAULT_VERBOSITY);

  return {
    store,
    auto_generate: 1,
    analyze_prompt: DEFAULT_ANALYZE_PROMPT,
    summarize_prompt: DEFAULT_SUMMARIZE_PROMPT,
    analyze_verbosity: DEFAULT_VERBOSITY,
    summarize_verbosity: DEFAULT_VERBOSITY
  };
};

export const getCreativeFunnelSummarySettings = (store) => {
  const settings = ensureSettings(store);
  return {
    ...settings,
    auto_generate: Boolean(settings.auto_generate),
    analyze_prompt: settings.analyze_prompt || DEFAULT_ANALYZE_PROMPT,
    summarize_prompt: settings.summarize_prompt || DEFAULT_SUMMARIZE_PROMPT,
    analyze_verbosity: settings.analyze_verbosity || DEFAULT_VERBOSITY,
    summarize_verbosity: settings.summarize_verbosity || DEFAULT_VERBOSITY
  };
};

export const updateCreativeFunnelSummarySettings = (store, updates = {}) => {
  const db = getDb();
  const settings = ensureSettings(store);
  const next = {
    auto_generate: typeof updates.auto_generate === 'boolean'
      ? (updates.auto_generate ? 1 : 0)
      : settings.auto_generate,
    analyze_prompt: updates.analyze_prompt ?? settings.analyze_prompt ?? DEFAULT_ANALYZE_PROMPT,
    summarize_prompt: updates.summarize_prompt ?? settings.summarize_prompt ?? DEFAULT_SUMMARIZE_PROMPT,
    analyze_verbosity: updates.analyze_verbosity ?? settings.analyze_verbosity ?? DEFAULT_VERBOSITY,
    summarize_verbosity: updates.summarize_verbosity ?? settings.summarize_verbosity ?? DEFAULT_VERBOSITY
  };

  db.prepare(`
    INSERT INTO creative_funnel_summary_settings (
      store, auto_generate, analyze_prompt, summarize_prompt, analyze_verbosity, summarize_verbosity, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store) DO UPDATE SET
      auto_generate = excluded.auto_generate,
      analyze_prompt = excluded.analyze_prompt,
      summarize_prompt = excluded.summarize_prompt,
      analyze_verbosity = excluded.analyze_verbosity,
      summarize_verbosity = excluded.summarize_verbosity,
      updated_at = excluded.updated_at
  `).run(store, next.auto_generate, next.analyze_prompt, next.summarize_prompt, next.analyze_verbosity, next.summarize_verbosity);

  return getCreativeFunnelSummarySettings(store);
};

export const getCreativeFunnelSummaries = (store) => {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM creative_funnel_summaries
    WHERE store = ?
    ORDER BY datetime(generated_at) DESC
  `).all(store);
};

export const saveCreativeFunnelSummary = ({
  store,
  mode,
  reportType,
  prompt,
  verbosity,
  content,
  generatedAt
}) => {
  const db = getDb();
  db.prepare(`
    INSERT INTO creative_funnel_summaries (
      store, mode, report_type, prompt, verbosity, content, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, mode, report_type) DO UPDATE SET
      prompt = excluded.prompt,
      verbosity = excluded.verbosity,
      content = excluded.content,
      generated_at = excluded.generated_at,
      created_at = CURRENT_TIMESTAMP
  `).run(store, mode, reportType, prompt, verbosity, content, generatedAt);
};

export const clearCreativeFunnelSummary = (store, mode) => {
  const db = getDb();
  const stmt = mode
    ? db.prepare(`DELETE FROM creative_funnel_summaries WHERE store = ? AND mode = ?`)
    : db.prepare(`DELETE FROM creative_funnel_summaries WHERE store = ?`);
  const result = mode ? stmt.run(store, mode) : stmt.run(store);
  return result.changes || 0;
};

const buildQuestion = (prompt, verbosity) =>
  `${prompt}\n\nVerbosity: ${verbosity}.`;

export const generateCreativeFunnelSummary = async ({
  store,
  mode,
  reportType,
  startDate,
  endDate,
  prompt,
  verbosity
}) => {
  let text = '';
  const onDelta = (delta) => {
    text += delta;
  };

  const question = buildQuestion(prompt, verbosity);
  if (mode === 'summarize') {
    await summarizeDataStream(question, store, onDelta, [], startDate, endDate, {
      model: AI_MODEL,
      reasoningEffort: AI_EFFORT
    });
  } else {
    await analyzeQuestionStream(question, store, onDelta, [], startDate, endDate, {
      model: AI_MODEL,
      reasoningEffort: AI_EFFORT
    });
  }

  const generatedAt = new Date().toISOString();
  saveCreativeFunnelSummary({
    store,
    mode,
    reportType,
    prompt,
    verbosity,
    content: text.trim(),
    generatedAt
  });

  return { content: text.trim(), generatedAt };
};

const shouldAutoGenerate = (settings) => Boolean(settings?.auto_generate);

export const runScheduledCreativeFunnelSummaries = async (reportType) => {
  const range = reportType === 'weekly' ? getWeeklyRange() : getDailyRange();

  for (const store of STORES) {
    const settings = getCreativeFunnelSummarySettings(store);
    if (!shouldAutoGenerate(settings)) continue;

    const analyzePrompt = settings.analyze_prompt || DEFAULT_ANALYZE_PROMPT;
    const summarizePrompt = settings.summarize_prompt || DEFAULT_SUMMARIZE_PROMPT;
    const analyzeVerbosity = settings.analyze_verbosity || DEFAULT_VERBOSITY;
    const summarizeVerbosity = settings.summarize_verbosity || DEFAULT_VERBOSITY;

    await generateCreativeFunnelSummary({
      store,
      mode: 'analyze',
      reportType,
      startDate: range.startDate,
      endDate: range.endDate,
      prompt: analyzePrompt,
      verbosity: analyzeVerbosity
    });

    await generateCreativeFunnelSummary({
      store,
      mode: 'summarize',
      reportType,
      startDate: range.startDate,
      endDate: range.endDate,
      prompt: summarizePrompt,
      verbosity: summarizeVerbosity
    });
  }
};

export const checkSpendResetAndGenerate = async () => {
  const db = getDb();
  const today = toGmt3DateString();
  const yesterday = addDays(today, -1);

  for (const store of STORES) {
    const settings = getCreativeFunnelSummarySettings(store);
    if (!shouldAutoGenerate(settings)) continue;

    const todaySpend = db.prepare(`
      SELECT SUM(spend) as total
      FROM meta_ad_metrics
      WHERE store = ? AND date = ?
    `).get(store, today)?.total || 0;

    const yesterdaySpend = db.prepare(`
      SELECT SUM(spend) as total
      FROM meta_ad_metrics
      WHERE store = ? AND date = ?
    `).get(store, yesterday)?.total || 0;

    if (todaySpend > 0 || yesterdaySpend <= 0) continue;

    const existing = db.prepare(`
      SELECT generated_at FROM creative_funnel_summaries
      WHERE store = ? AND report_type = 'daily'
      ORDER BY datetime(generated_at) DESC
      LIMIT 1
    `).get(store);

    if (existing?.generated_at) {
      const existingDate = new Date(existing.generated_at);
      const todayBoundary = new Date(`${today}T00:00:00+03:00`);
      if (existingDate >= todayBoundary) continue;
    }

    const range = { startDate: yesterday, endDate: yesterday };
    const analyzePrompt = settings.analyze_prompt || DEFAULT_ANALYZE_PROMPT;
    const summarizePrompt = settings.summarize_prompt || DEFAULT_SUMMARIZE_PROMPT;
    const analyzeVerbosity = settings.analyze_verbosity || DEFAULT_VERBOSITY;
    const summarizeVerbosity = settings.summarize_verbosity || DEFAULT_VERBOSITY;

    await generateCreativeFunnelSummary({
      store,
      mode: 'analyze',
      reportType: 'daily',
      startDate: range.startDate,
      endDate: range.endDate,
      prompt: analyzePrompt,
      verbosity: analyzeVerbosity
    });

    await generateCreativeFunnelSummary({
      store,
      mode: 'summarize',
      reportType: 'daily',
      startDate: range.startDate,
      endDate: range.endDate,
      prompt: summarizePrompt,
      verbosity: summarizeVerbosity
    });
  }
};
