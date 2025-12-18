/**
 * Robust timestamp parsing and time-ago calculation utilities
 * Handles multiple timestamp formats and timezones
 */

/**
 * Parse a timestamp from various formats
 * Supports: ISO 8601, Unix timestamps, SQLite datetime, etc.
 * 
 * @param {string|number|Date} timestamp - The timestamp to parse
 * @returns {Date|null} Parsed date or null if invalid
 */
export const parseTimestamp = (timestamp) => {
  if (!timestamp) return null;

  // Already a Date object
  if (timestamp instanceof Date) {
    return isValidDate(timestamp) ? timestamp : null;
  }

  // String timestamp
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();

    // ISO 8601 format (2024-01-15T10:30:00Z or 2024-01-15T10:30:00.123Z)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      const date = new Date(trimmed);
      return isValidDate(date) ? date : null;
    }

    // SQLite datetime format (2024-01-15 10:30:00)
    // These timestamps are stored in UTC but lack timezone info.
    // Normalize to ISO UTC so the client doesn't interpret them as local time
    // and accidentally shift the "time ago" calculation.
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      const normalized = `${trimmed.replace(' ', 'T')}Z`;
      const date = new Date(normalized);
      return isValidDate(date) ? date : null;
    }

    // Try parsing as-is (handles various formats)
    const date = new Date(trimmed);
    return isValidDate(date) ? date : null;
  }

  // Unix timestamp (milliseconds or seconds)
  if (typeof timestamp === 'number') {
    // If the number is very large, it's likely milliseconds; if small, it's seconds
    const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    const date = new Date(ms);
    return isValidDate(date) ? date : null;
  }

  return null;
};

/**
 * Check if a Date object is valid
 * @param {Date} date - The date to validate
 * @returns {boolean}
 */
export const isValidDate = (date) => {
  return date instanceof Date && !isNaN(date.getTime());
};

/**
 * Calculate time-ago string with per-item accuracy
 * Uses user's local timezone
 * 
 * @param {string|number|Date} timestamp - The event timestamp
 * @param {Date} referenceTime - The reference "now" time (defaults to current time)
 * @returns {string} Human-readable time string
 */
export const getTimeAgo = (timestamp, referenceTime = new Date()) => {
  const eventDate = parseTimestamp(timestamp);

  // Invalid or missing timestamp
  if (!eventDate) {
    return '—';
  }

  // Ensure reference time is a Date
  const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
  if (!isValidDate(now)) {
    return '—';
  }

  const diffMs = now.getTime() - eventDate.getTime();

  // Handle future timestamps (shouldn't happen, but be safe)
  if (diffMs < 0) {
    return 'Just now';
  }

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;

  // Fall back to formatted date for older notifications
  return eventDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: eventDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
};

/**
 * Format a timestamp for display (full date and time)
 * Uses user's local timezone
 * 
 * @param {string|number|Date} timestamp - The timestamp to format
 * @returns {string} Formatted date string
 */
export const formatTimestamp = (timestamp) => {
  const eventDate = parseTimestamp(timestamp);

  if (!eventDate) {
    return '—';
  }

  return eventDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

/**
 * Get a tooltip string with both "time ago" and full date
 * @param {string|number|Date} timestamp - The timestamp
 * @param {Date} referenceTime - Reference time for calculation
 * @returns {string}
 */
export const getTimestampTooltip = (timestamp, referenceTime = new Date()) => {
  const eventDate = parseTimestamp(timestamp);

  if (!eventDate) {
    return 'Unknown time';
  }

  const timeAgo = getTimeAgo(timestamp, referenceTime);
  const fullDate = formatTimestamp(timestamp);

  return `${timeAgo} (${fullDate})`;
};
