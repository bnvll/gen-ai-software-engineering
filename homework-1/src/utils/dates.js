'use strict';

/**
 * Date handling rules for the API (dates are always ISO 8601, always stored in
 * UTC):
 *
 *  - `2024-01-15`                  -> a calendar day
 *  - `2024-01-15T10:30:00Z`        -> an instant
 *  - `2024-01-15T10:30:00`         -> an instant, interpreted as UTC
 *  - `2024-01-15T10:30:00+02:00`   -> an instant with an explicit offset
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** True when the calendar date really exists (rejects 2024-02-31). */
function isRealCalendarDate(text) {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/**
 * Parses an ISO 8601 date or date-time into a Date.
 * @returns {?Date} null when the value is not a valid ISO 8601 timestamp.
 */
function parseIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();

  if (DATE_ONLY.test(text)) {
    return isRealCalendarDate(text) ? new Date(`${text}T00:00:00.000Z`) : null;
  }
  if (!DATE_TIME.test(text)) return null;
  if (!isRealCalendarDate(text.slice(0, 10))) return null;

  // No trailing Z/offset means "UTC" here, not "server local time".
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = hasOffset ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parses a `from` / `to` filter boundary. A bare calendar date is expanded to
 * the whole UTC day so `?from=2024-01-01&to=2024-01-31` includes every
 * transaction emitted on 31 January.
 *
 * @param {string} value
 * @param {{endOfDay?: boolean}} [options]
 * @returns {?Date}
 */
function parseDateBoundary(value, { endOfDay = false } = {}) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (DATE_ONLY.test(text)) {
    if (!isRealCalendarDate(text)) return null;
    return new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  return parseIsoTimestamp(text);
}

module.exports = { parseIsoTimestamp, parseDateBoundary, DATE_ONLY, DATE_TIME };
