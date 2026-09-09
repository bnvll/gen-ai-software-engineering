'use strict';

const { ValidationErrorBag, ValidationError } = require('../utils/errors');
const { isSupportedCurrency } = require('../utils/currencies');
const { isValidAccountId, normalizeAccountId, ACCOUNT_FORMAT_HINT } = require('../utils/accounts');
const { parseDateBoundary } = require('../utils/dates');
const { TRANSACTION_TYPES, TRANSACTION_STATUSES } = require('../models/transaction');

/** Export formats supported by GET /transactions/export. */
const EXPORT_FORMATS = ['csv', 'json'];

/** Day-count basis for the simple interest calculation. */
const DAY_COUNT_BASIS = 365;
const MAX_INTEREST_DAYS = 36_500; // 100 years

/**
 * Express can deliver a repeated query parameter as an array (`?type=a&type=b`).
 * We only ever accept a single value, so arrays are rejected explicitly instead
 * of being silently coerced to "a,b".
 */
function singleValue(query, field, bag) {
  const raw = query[field];
  if (Array.isArray(raw)) {
    bag.add(field, `${field} must be provided at most once`);
    return undefined;
  }
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') {
    bag.add(field, `${field} must be a string`);
    return undefined;
  }
  return raw.trim();
}

function validateEnum(query, field, allowed, bag) {
  const value = singleValue(query, field, bag);
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    bag.add(field, `${field} must be one of: ${allowed.join(', ')}`);
    return undefined;
  }
  return value;
}

/**
 * Validates the filters of GET /transactions (and of the CSV export, which
 * reuses them).
 *
 * Unknown query parameters are ignored rather than rejected, so clients can
 * append their own cache-busting or tracking parameters.
 *
 * @returns {{accountId?: string, type?: string, status?: string,
 *            currency?: string, from?: Date, to?: Date}}
 */
function validateTransactionFilters(query = {}) {
  const bag = new ValidationErrorBag();
  const filters = {};

  const accountId = singleValue(query, 'accountId', bag);
  if (accountId !== undefined) {
    if (!isValidAccountId(accountId)) bag.add('accountId', ACCOUNT_FORMAT_HINT);
    else filters.accountId = normalizeAccountId(accountId);
  }

  const type = validateEnum(query, 'type', TRANSACTION_TYPES, bag);
  if (type) filters.type = type;

  const status = validateEnum(query, 'status', TRANSACTION_STATUSES, bag);
  if (status) filters.status = status;

  const currency = singleValue(query, 'currency', bag);
  if (currency !== undefined) {
    if (!isSupportedCurrency(currency)) {
      bag.add('currency', 'Invalid currency code. Use a supported ISO 4217 code (e.g. USD, EUR, GBP, JPY)');
    } else {
      filters.currency = currency.toUpperCase();
    }
  }

  for (const [field, endOfDay] of [['from', false], ['to', true]]) {
    const value = singleValue(query, field, bag);
    if (value === undefined) continue;
    const parsed = parseDateBoundary(value, { endOfDay });
    if (!parsed) {
      bag.add(field, `${field} must be a date (YYYY-MM-DD) or an ISO 8601 datetime`);
      continue;
    }
    filters[field] = parsed;
  }

  if (filters.from && filters.to && filters.from > filters.to) {
    bag.add('to', 'to must be the same as or later than from');
  }

  bag.throwIfAny();
  return filters;
}

/**
 * Validates `:accountId` taken from the URL path.
 * @returns {string} the normalized account id
 * @throws {ValidationError} when the id does not match ACC-XXXXX
 */
function validateAccountIdParam(value) {
  if (!isValidAccountId(value)) {
    throw new ValidationError([{ field: 'accountId', message: ACCOUNT_FORMAT_HINT }]);
  }
  return normalizeAccountId(value);
}

/**
 * Validates the `?currency=` selector used by the balance / summary / interest
 * endpoints to pick a single currency for an account.
 * @returns {?string}
 */
function validateCurrencySelector(query = {}) {
  const bag = new ValidationErrorBag();
  const currency = singleValue(query, 'currency', bag);
  bag.throwIfAny();
  if (currency === undefined) return null;
  if (!isSupportedCurrency(currency)) {
    throw new ValidationError([{
      field: 'currency',
      message: 'Invalid currency code. Use a supported ISO 4217 code (e.g. USD, EUR, GBP, JPY)',
    }]);
  }
  return currency.toUpperCase();
}

/** Validates `?format=` of GET /transactions/export. Defaults to csv. */
function validateExportFormat(query = {}) {
  const bag = new ValidationErrorBag();
  const format = singleValue(query, 'format', bag);
  bag.throwIfAny();
  if (format === undefined) return 'csv';
  const normalized = format.toLowerCase();
  if (!EXPORT_FORMATS.includes(normalized)) {
    throw new ValidationError([{
      field: 'format',
      message: `format must be one of: ${EXPORT_FORMATS.join(', ')}`,
    }]);
  }
  return normalized;
}

/**
 * Validates `?rate=` and `?days=` of the simple interest endpoint.
 * `rate` is an annual rate expressed as a decimal fraction (0.05 = 5%).
 *
 * @returns {{rate: number, days: number}}
 */
function validateInterestParams(query = {}) {
  const bag = new ValidationErrorBag();

  const rawRate = singleValue(query, 'rate', bag);
  const rawDays = singleValue(query, 'days', bag);

  let rate = null;
  if (rawRate === undefined) {
    bag.add('rate', 'rate is required (annual rate as a decimal fraction, e.g. 0.05 for 5%)');
  } else {
    const parsed = Number(rawRate);
    if (!Number.isFinite(parsed)) bag.add('rate', 'rate must be a number (e.g. 0.05)');
    else if (parsed < 0) bag.add('rate', 'rate must not be negative');
    else if (parsed > 1) bag.add('rate', 'rate must be a decimal fraction between 0 and 1 (use 0.05 for 5%)');
    else rate = parsed;
  }

  let days = null;
  if (rawDays === undefined) {
    bag.add('days', 'days is required (number of days to accrue interest for)');
  } else {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed)) bag.add('days', 'days must be a whole number');
    else if (parsed <= 0) bag.add('days', 'days must be a positive whole number');
    else if (parsed > MAX_INTEREST_DAYS) bag.add('days', `days must not exceed ${MAX_INTEREST_DAYS}`);
    else days = parsed;
  }

  bag.throwIfAny();
  return { rate, days };
}

module.exports = {
  validateTransactionFilters,
  validateAccountIdParam,
  validateCurrencySelector,
  validateExportFormat,
  validateInterestParams,
  EXPORT_FORMATS,
  DAY_COUNT_BASIS,
};
