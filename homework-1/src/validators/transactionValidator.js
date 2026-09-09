'use strict';

const { ValidationErrorBag } = require('../utils/errors');
const { decimalPlaces } = require('../utils/money');
const {
  isSupportedCurrency,
  allowedDecimals,
  MAX_ACCEPTED_DECIMALS,
} = require('../utils/currencies');
const { isValidAccountId, normalizeAccountId, ACCOUNT_FORMAT_HINT } = require('../utils/accounts');
const { parseIsoTimestamp } = require('../utils/dates');
const {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  ACCOUNT_RULES,
} = require('../models/transaction');

/** Fields a client may send to POST /transactions. */
const ACCEPTED_FIELDS = ['fromAccount', 'toAccount', 'amount', 'currency', 'type', 'timestamp', 'status'];

/** Money amounts above this are rejected as almost certainly a mistake. */
const MAX_AMOUNT = 1_000_000_000;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the type first, because the account rules depend on it.
 * @returns {?string} the valid type, or null.
 */
function validateType(body, bag) {
  const { type } = body;
  if (type === undefined || type === null || type === '') {
    bag.add('type', 'Type is required');
    return null;
  }
  if (typeof type !== 'string' || !TRANSACTION_TYPES.includes(type)) {
    bag.add('type', `Type must be one of: ${TRANSACTION_TYPES.join(', ')}`);
    return null;
  }
  return type;
}

/**
 * Applies the per-type account rules (required / forbidden) and the
 * `ACC-XXXXX` format check.
 * @returns {{fromAccount: ?string, toAccount: ?string}}
 */
function validateAccounts(body, type, bag) {
  const rules = ACCOUNT_RULES[type] ?? { fromAccount: 'optional', toAccount: 'optional' };
  const result = { fromAccount: null, toAccount: null };

  for (const field of ['fromAccount', 'toAccount']) {
    const raw = body[field];
    const provided = raw !== undefined && raw !== null && raw !== '';
    const rule = rules[field];

    if (!provided) {
      if (rule === 'required') {
        bag.add(field, `${field} is required for ${type} transactions`);
      }
      continue;
    }
    if (rule === 'forbidden') {
      const reason = type === 'deposit'
        ? 'funds originate outside the ledger'
        : 'funds leave the ledger';
      bag.add(field, `${field} must be omitted for ${type} transactions (${reason})`);
      continue;
    }
    if (typeof raw !== 'string' || !isValidAccountId(raw)) {
      bag.add(field, ACCOUNT_FORMAT_HINT);
      continue;
    }
    result[field] = normalizeAccountId(raw);
  }

  if (type === 'transfer' && result.fromAccount && result.fromAccount === result.toAccount) {
    bag.add('toAccount', 'toAccount must be different from fromAccount');
  }
  return result;
}

/** @returns {?string} the normalized ISO 4217 code, or null. */
function validateCurrency(body, bag) {
  const { currency } = body;
  if (currency === undefined || currency === null || currency === '') {
    bag.add('currency', 'Currency is required');
    return null;
  }
  if (typeof currency !== 'string' || !isSupportedCurrency(currency)) {
    bag.add('currency', 'Invalid currency code. Use a supported ISO 4217 code (e.g. USD, EUR, GBP, JPY)');
    return null;
  }
  return currency.toUpperCase();
}

/**
 * Amount must be a positive JSON number with at most 2 decimal places - and at
 * most as many decimals as the currency actually has (JPY has none).
 * @returns {?number}
 */
function validateAmount(body, currency, bag) {
  const { amount } = body;
  if (amount === undefined || amount === null || amount === '') {
    bag.add('amount', 'Amount is required');
    return null;
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    bag.add('amount', 'Amount must be a positive number');
    return null;
  }
  if (amount <= 0) {
    bag.add('amount', 'Amount must be a positive number');
    return null;
  }
  if (amount > MAX_AMOUNT) {
    bag.add('amount', `Amount must not exceed ${MAX_AMOUNT.toLocaleString('en-US')}`);
    return null;
  }

  const decimals = decimalPlaces(amount);
  const maxDecimals = currency ? allowedDecimals(currency) : MAX_ACCEPTED_DECIMALS;
  if (decimals > maxDecimals) {
    bag.add(
      'amount',
      maxDecimals === 0
        ? `Amount must be a whole number for ${currency} (${currency} has no minor unit)`
        : `Amount must have at most ${maxDecimals} decimal places`,
    );
    return null;
  }
  return amount;
}

/** @returns {?string} an ISO 8601 UTC timestamp; defaults to "now". */
function validateTimestamp(body, bag) {
  const { timestamp } = body;
  if (timestamp === undefined || timestamp === null || timestamp === '') {
    return new Date().toISOString();
  }
  const parsed = parseIsoTimestamp(timestamp);
  if (!parsed) {
    bag.add('timestamp', 'Timestamp must be a valid ISO 8601 datetime (e.g. 2024-01-15T10:30:00Z)');
    return null;
  }
  return parsed.toISOString();
}

/** @returns {?string} the status; defaults to "completed". */
function validateStatus(body, bag) {
  const { status } = body;
  if (status === undefined || status === null || status === '') return 'completed';
  if (typeof status !== 'string' || !TRANSACTION_STATUSES.includes(status)) {
    bag.add('status', `Status must be one of: ${TRANSACTION_STATUSES.join(', ')}`);
    return null;
  }
  return status;
}

/**
 * Validates a POST /transactions payload and returns the normalized input for
 * the store. Every field is checked before throwing, so the client receives
 * the full list of problems in one response.
 *
 * @param {unknown} body
 * @throws {import('../utils/errors').ValidationError}
 */
function validateCreateTransaction(body) {
  const bag = new ValidationErrorBag();

  if (!isPlainObject(body)) {
    bag.add('body', 'Request body must be a JSON object');
    bag.throwIfAny();
  }

  const type = validateType(body, bag);
  const accounts = validateAccounts(body, type, bag);
  const currency = validateCurrency(body, bag);
  const amount = validateAmount(body, currency, bag);
  const timestamp = validateTimestamp(body, bag);
  const status = validateStatus(body, bag);

  bag.throwIfAny();

  return { ...accounts, amount, currency, type, timestamp, status };
}

module.exports = { validateCreateTransaction, ACCEPTED_FIELDS, MAX_AMOUNT };
