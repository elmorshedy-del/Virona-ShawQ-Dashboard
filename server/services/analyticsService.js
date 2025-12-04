// server/services/analyticsService.js
import { getDb } from '../db/database.js';

// Country info lookup
const COUNTRY_INFO = {
  // GCC
  SA: { name: 'Saudi Arabia', flag: '🇸🇦' },
  AE: { name: 'United Arab Emirates', flag: '🇦🇪' },
  KW: { name: 'Kuwait', flag: '🇰🇼' },
  QA: { name: 'Qatar', flag: '🇶🇦' },
  OM: { name: 'Oman', flag: '🇴🇲' },
  BH: { name: 'Bahrain', flag: '🇧🇭' },
  // Western
  US: { name: 'United States', flag: '🇺🇸' },
  GB: { name: 'United Kingdom', flag: '🇬🇧' },
  CA: { name: 'Canada', flag: '🇨🇦' },
  DE: { name: 'Germany', flag: '🇩🇪' },
  NL: { name: 'Netherlands', flag: '🇳🇱' },
  FR: { name: 'France', flag: '🇫🇷' },
  AU: { name: 'Australia', flag: '🇦🇺' },
  IT: { name: 'Italy', flag: '🇮🇹' },
  ES: { name: 'Spain', flag: '🇪🇸' },
  SE: { name: 'Sweden', flag: '🇸🇪' },
  NO: { name: 'Norway', flag: '🇳🇴' },
  DK: { name: 'Denmark', flag: '🇩🇰' },
  BE: { name: 'Belgium', flag: '🇧🇪' },
  CH: { name: 'Switzerland', flag: '🇨🇭' },
  AT: { name: 'Austria', flag: '🇦🇹' },
  IE: { name: 'Ireland', flag: '🇮🇪' },
  NZ: { name: 'New Zealand', flag: '🇳🇿' }
};

function getCountryInfo(code) {
  return COUNTRY_INFO[code] || { name: code, flag: '🏳️' };
}

function getDateRange(params) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Explicit custom range
  if (params.startDate && params.endDate) {
    const start = new Date(params.startDate);
    const end = ne
