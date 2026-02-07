import OpenAI from 'openai';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_TEMPERATURE = 1.0;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

let deepseekClient = null;

function getDeepSeekBaseUrl() {
  const raw = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).trim();
  return raw || DEFAULT_BASE_URL;
}

function requireDeepSeekKey() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error('DEEPSEEK_API_KEY is not configured.');
  }
  return key;
}

function getDeepSeekClient() {
  if (deepseekClient) return deepseekClient;
  deepseekClient = new OpenAI({
    baseURL: getDeepSeekBaseUrl(),
    apiKey: requireDeepSeekKey()
  });
  return deepseekClient;
}

function clampMaxTokens(value) {
  const raw = Number.parseInt(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS || `${DEFAULT_MAX_OUTPUT_TOKENS}`, 10);
  const cap = Number.isFinite(raw) ? Math.max(256, raw) : DEFAULT_MAX_OUTPUT_TOKENS;
  const requested = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : cap;
  return Math.min(requested, cap);
}

export function normalizeTemperature(value, fallback = DEFAULT_TEMPERATURE) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(2, num));
}

function formatDeepSeekError(error) {
  return {
    message: error?.message || 'DeepSeek request failed.',
    status: error?.status || error?.response?.status || null,
    code: error?.code || error?.error?.code || null,
    type: error?.type || error?.error?.type || null,
    param: error?.param || error?.error?.param || null,
    requestId: error?.request_id || error?.response?.headers?.get?.('x-request-id') || null
  };
}

export async function askDeepSeekChat({
  model = 'deepseek-chat',
  systemPrompt = '',
  messages = [],
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  temperature = DEFAULT_TEMPERATURE
}) {
  const client = getDeepSeekClient();
  const safeTemp = normalizeTemperature(temperature, DEFAULT_TEMPERATURE);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((message) => ({ role: message.role, content: message.content }))
      ],
      max_tokens: clampMaxTokens(maxOutputTokens),
      temperature: safeTemp
    });

    return {
      text: response?.choices?.[0]?.message?.content ?? '',
      model
    };
  } catch (error) {
    const details = formatDeepSeekError(error);
    console.warn('[DeepSeek] ask failed:', { model, ...details });
    throw new Error(details.message);
  }
}

export async function streamDeepSeekChat({
  model = 'deepseek-chat',
  systemPrompt = '',
  messages = [],
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  onDelta
}) {
  const client = getDeepSeekClient();
  const safeTemp = normalizeTemperature(temperature, DEFAULT_TEMPERATURE);

  if (typeof onDelta !== 'function') {
    throw new Error('streamDeepSeekChat requires onDelta(text).');
  }

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((message) => ({ role: message.role, content: message.content }))
      ],
      max_tokens: clampMaxTokens(maxOutputTokens),
      temperature: safeTemp,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    }

    return { model };
  } catch (error) {
    const details = formatDeepSeekError(error);
    console.warn('[DeepSeek] stream failed:', { model, ...details });
    throw new Error(details.message);
  }
}

