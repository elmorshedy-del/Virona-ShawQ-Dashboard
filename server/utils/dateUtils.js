// Utility to format dates in GMT+3 (used for order/day-level reporting)
const GMT3_OFFSET_HOURS = 3;
const GMT3_OFFSET_MS = GMT3_OFFSET_HOURS * 60 * 60 * 1000;

export function formatDateAsGmt3(date = new Date()) {
  const gmt3Date = new Date(date.getTime() + GMT3_OFFSET_MS);
  return gmt3Date.toISOString().split('T')[0];
}
