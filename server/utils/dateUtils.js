// Utility to format dates using the local timezone (no UTC shift)
export function formatLocalDate(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(date.getTime() - offsetMs);
  return localDate.toISOString().split('T')[0];
}
