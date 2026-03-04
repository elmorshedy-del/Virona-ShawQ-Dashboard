import OpenAI from 'openai';
import { normalizeTemperature } from './deepseekService.js';

const DEFAULT_FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_FIREWORKS_MODEL = 'accounts/fireworks/models/glm-5';
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MIN_MAX_OUTPUT_TOKENS = 256;
const DEFAULT_TEMPERATURE = 1.0;
const FIREWORKS_API_KEY_ENV = 'FIREWORKS_API_KEY';
const FIREWORKS_BASE_URL_ENV = 'FIREWORKS_BASE_URL';
const FIREWORKS_MAX_OUTPUT_TOKENS_ENV = 'FIREWORKS_MAX_OUTPUT_TOKENS';
const FIREWORKS_DEFAULT_MODEL_ENV = 'FIREWORKS_DEFAULT_MODEL';
const FIREWORKS_REASONING_OPTIONS = new Set(['low', 'medium', 'high']);

let fireworksClient = null;

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFireworksConfigured() {
  return hasNonEmptyString(process.env[FIREWORKS_API_KEY_ENV]);
}

function getFireworksBaseUrl() {
  const raw = (process.env[FIREWORKS_BASE_URL_ENV] || DEFAULT_FIREWORKS_BASE_URL).trim();
  return raw || DEFAULT_FIREWORKS_BASE_URL;
}

function requireFireworksApiKey() {
  const key = process.env[FIREWORKS_API_KEY_ENV];
  if (!key) {
    throw new Error(`${FIREWORKS_API_KEY_ENV} is not configured.`);
  }
  return key;
}

function getFireworksClient() {
  if (fireworksClient) return fireworksClient;
  fireworksClient = new OpenAI({
    baseURL: getFireworksBaseUrl(),
    apiKey: requireFireworksApiKey()
  });
  return fireworksClient;
}

function resolveFireworksModel(requestedModel) {
  if (hasNonEmptyString(requestedModel)) return requestedModel.trim();

  const envModel = process.env[FIREWORKS_DEFAULT_MODEL_ENV];
  if (hasNonEmptyString(envModel)) return envModel.trim();

  return DEFAULT_FIREWORKS_MODEL;
}

function clampMaxTokens(value) {
  const envRaw = Number.parseInt(process.env[FIREWORKS_MAX_OUTPUT_TOKENS_ENV] || `${DEFAULT_MAX_OUTPUT_TOKENS}`, 10);
  const cap = Number.isFinite(envRaw) ? Math.max(MIN_MAX_OUTPUT_TOKENS, envRaw) : DEFAULT_MAX_OUTPUT_TOKENS;
  const requested = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : cap;
  return Math.min(requested, cap);
}

function applyVerbosityInstruction(systemPrompt = '', verbosity = 'low') {
  const normalizedVerbosity = typeof verbosity === 'string' ? verbosity.trim().toLowerCase() : 'low';
  const verbosityDirective = normalizedVerbosity === 'low'
    ? 'Response style requirement: non-verbose. Keep the response concise, high-signal, and skimmable.'
    : 'Response style requirement: verbose. Provide fuller explanation, context, and explicit action guidance.';

  return [systemPrompt, verbosityDirective].filter(Boolean).join('\n\n');
}

function normalizeReasoningEffort(reasoningEffort) {
  if (!hasNonEmptyString(reasoningEffort)) return undefined;
  const normalized = reasoningEffort.trim().toLowerCase();
  return FIREWORKS_REASONING_OPTIONS.has(normalized) ? normalized : undefined;
}

function formatFireworksError(error) {
  return {
    message: error?.message || 'Fireworks request failed.',
    status: error?.status || error?.response?.status || null,
    code: error?.code || error?.error?.code || null,
    type: error?.type || error?.error?.type || null,
    param: error?.param || error?.error?.param || null,
    requestId: error?.request_id || error?.response?.headers?.get?.('x-request-id') || null
  };
}

export async function askFireworksChat({
  model = null,
  systemPrompt = '',
  messages = [],
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  verbosity = 'low',
  reasoningEffort = 'high'
}) {
  const resolvedModel = resolveFireworksModel(model);
  const client = getFireworksClient();
  const safeTemp = normalizeTemperature(temperature, DEFAULT_TEMPERATURE);
  const safeReasoningEffort = normalizeReasoningEffort(reasoningEffort);

  try {
    const response = await client.chat.completions.create({
      model: resolvedModel,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: applyVerbosityInstruction(systemPrompt, verbosity) }] : []),
        ...messages.map((message) => ({ role: message.role, content: message.content }))
      ],
      max_tokens: clampMaxTokens(maxOutputTokens),
      temperature: safeTemp,
      reasoning_effort: safeReasoningEffort
    });

    return {
      text: response?.choices?.[0]?.message?.content ?? '',
      model: resolvedModel
    };
  } catch (error) {
    const details = formatFireworksError(error);
    console.warn('[Fireworks] ask failed:', { model: resolvedModel, ...details });
    throw new Error(details.message);
  }
}

export async function streamFireworksChat({
  model = null,
  systemPrompt = '',
  messages = [],
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  verbosity = 'low',
  reasoningEffort = 'high',
  onDelta
}) {
  if (typeof onDelta !== 'function') {
    throw new Error('streamFireworksChat requires onDelta(text).');
  }

  const resolvedModel = resolveFireworksModel(model);
  const client = getFireworksClient();
  const safeTemp = normalizeTemperature(temperature, DEFAULT_TEMPERATURE);
  const safeReasoningEffort = normalizeReasoningEffort(reasoningEffort);

  try {
    const stream = await client.chat.completions.create({
      model: resolvedModel,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: applyVerbosityInstruction(systemPrompt, verbosity) }] : []),
        ...messages.map((message) => ({ role: message.role, content: message.content }))
      ],
      max_tokens: clampMaxTokens(maxOutputTokens),
      temperature: safeTemp,
      reasoning_effort: safeReasoningEffort,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    }

    return { model: resolvedModel };
  } catch (error) {
    const details = formatFireworksError(error);
    console.warn('[Fireworks] stream failed:', { model: resolvedModel, ...details });
    throw new Error(details.message);
  }
}
