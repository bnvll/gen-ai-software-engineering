'use strict';

/**
 * Account numbers follow the assignment format `ACC-XXXXX`, where each X is a
 * single alphanumeric character (5 of them). Comparison is case-insensitive:
 * "acc-12345" and "ACC-12345" are the same account, and we store the
 * uppercase form so balances never split across spellings.
 */
const ACCOUNT_PATTERN = /^ACC-[A-Z0-9]{5}$/;
const ACCOUNT_FORMAT_HINT = 'Account number must match ACC-XXXXX, where X is alphanumeric (e.g. ACC-12345)';

function normalizeAccountId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function isValidAccountId(value) {
  return typeof value === 'string' && ACCOUNT_PATTERN.test(normalizeAccountId(value));
}

module.exports = { ACCOUNT_PATTERN, ACCOUNT_FORMAT_HINT, normalizeAccountId, isValidAccountId };
