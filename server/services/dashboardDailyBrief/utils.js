import { DASHBOARD_DAILY_BRIEF_DEFAULTS } from './constants.js';

const AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

export function parseJsonObject(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;

  const parseCandidate = (value) => {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  };

  const direct = parseCandidate(normalized);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct;
  }

  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = normalized.slice(firstBrace, lastBrace + 1);
    const parsed = parseCandidate(sliced);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function coerceSingleParagraphText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]+\s+/, '').replace(/^\d+[.)]\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeParagraph(paragraph, fallback = 'No daily brief was produced.') {
  const normalized = coerceSingleParagraphText(paragraph);
  if (!normalized) return fallback;
  if (normalized.length <= DASHBOARD_DAILY_BRIEF_DEFAULTS.maxParagraphChars) {
    return normalized;
  }
  return `${normalized.slice(0, DASHBOARD_DAILY_BRIEF_DEFAULTS.maxParagraphChars - 3).trim()}...`;
}

export function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

export function safeDivide(numerator, denominator, fallback = 0) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return fallback;
  }
  return top / bottom;
}

export function parseIsoDate(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatAmount(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return AMOUNT_FORMATTER.format(numeric);
}

export function formatCount(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return COUNT_FORMATTER.format(numeric);
}

export function formatMetric(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return String(round(numeric, 2));
}

export function formatPercentFromRatio(ratio) {
  const numeric = toFiniteNumber(ratio);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.abs(round(numeric * 100, 1))}%`;
}

export function toSafeErrorMessage(error, fallback = 'Unknown error') {
  const message = String(error?.message || fallback).trim();
  return message || fallback;
}
