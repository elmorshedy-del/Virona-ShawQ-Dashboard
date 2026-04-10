import { COUNTRIES as MASTER_COUNTRIES } from '../../data/countries';

const COUNTRY_NAME_BY_CODE = new Map(
  MASTER_COUNTRIES.map((country) => [
    String(country.code || '').trim().toUpperCase(),
    country.name
  ])
);

const WORLD_ATLAS_NAME_BY_COUNTRY_CODE = Object.freeze({
  BA: 'Bosnia and Herz.',
  BN: 'Brunei',
  CD: 'Dem. Rep. Congo',
  CF: 'Central African Rep.',
  DO: 'Dominican Rep.',
  GB: 'United Kingdom',
  KP: 'North Korea',
  KR: 'South Korea',
  LA: 'Laos',
  MD: 'Moldova',
  MK: 'Macedonia',
  PS: 'Palestine',
  RU: 'Russia',
  SY: 'Syria',
  TR: 'Turkey',
  TW: 'Taiwan',
  TZ: 'Tanzania',
  VA: 'Vatican',
  VN: 'Vietnam'
});

let regionDisplayNames = null;

function getIntlRegionName(countryCode) {
  try {
    if (!regionDisplayNames && typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      regionDisplayNames = new Intl.DisplayNames(undefined, { type: 'region' });
    }
    return regionDisplayNames?.of(countryCode) || null;
  } catch (_error) {
    return null;
  }
}

export function normalizeCountryKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function countryNameFromCode(value) {
  const normalizedCode = String(value || '').trim().toUpperCase();
  if (!normalizedCode) return '—';
  if (!/^[A-Z]{2}$/.test(normalizedCode)) return normalizedCode;

  return COUNTRY_NAME_BY_CODE.get(normalizedCode)
    || getIntlRegionName(normalizedCode)
    || normalizedCode;
}

export function resolveWorldAtlasCountryKey(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;

  if (/^[A-Za-z]{2}$/.test(normalizedValue)) {
    const countryCode = normalizedValue.toUpperCase();
    const atlasName = WORLD_ATLAS_NAME_BY_COUNTRY_CODE[countryCode]
      || COUNTRY_NAME_BY_CODE.get(countryCode)
      || getIntlRegionName(countryCode)
      || countryCode;
    return normalizeCountryKey(atlasName);
  }

  return normalizeCountryKey(normalizedValue);
}
