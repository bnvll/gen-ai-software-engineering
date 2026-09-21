'use strict';

const { randomUUID } = require('node:crypto');
const { toMinorUnits, fromMinorUnits } = require('../utils/money');

/** Transaction types supported by the ledger. */
const TRANSACTION_TYPES = ['deposit', 'withdrawal', 'transfer'];

/** Lifecycle states a transaction can be in. */
const TRANSACTION_STATUSES = ['pending', 'completed', 'failed'];

/**
 * Which account fields each type uses. `deposit` money arrives from outside the
 * ledger (no fromAccount), `withdrawal` leaves it (no toAccount), `transfer`
 * moves money between two known accounts.
 */
const ACCOUNT_RULES = {
  deposit: { fromAccount: 'forbidden', toAccount: 'required' },
  withdrawal: { fromAccount: 'required', toAccount: 'forbidden' },
  transfer: { fromAccount: 'required', toAccount: 'required' },
};

/**
 * Builds the internal record from an already-validated payload.
 * Internally the amount lives in `amountMinor` (integer minor units); the
 * decimal `amount` is re-derived on serialization.
 *
 * @param {{fromAccount: ?string, toAccount: ?string, amount: number,
 *          currency: string, type: string, timestamp: string, status: string}} input
 */
function createTransactionRecord(input) {
  return {
    id: randomUUID(),
    fromAccount: input.fromAccount ?? null,
    toAccount: input.toAccount ?? null,
    amountMinor: toMinorUnits(input.amount, input.currency),
    currency: input.currency,
    type: input.type,
    timestamp: input.timestamp,
    status: input.status,
    createdAt: new Date().toISOString(),
  };
}

/** Public JSON representation of a transaction (the documented API contract). */
function serializeTransaction(record) {
  return {
    id: record.id,
    fromAccount: record.fromAccount,
    toAccount: record.toAccount,
    amount: fromMinorUnits(record.amountMinor, record.currency),
    currency: record.currency,
    type: record.type,
    timestamp: record.timestamp,
    status: record.status,
  };
}

/**
 * Signed effect of a transaction on one account, in minor units.
 * Returns 0 when the transaction does not touch the account.
 */
function signedAmountFor(record, accountId) {
  let effect = 0;
  if (record.toAccount === accountId) effect += record.amountMinor;
  if (record.fromAccount === accountId) effect -= record.amountMinor;
  return effect;
}

/** True when the transaction has the given account on either side. */
function touchesAccount(record, accountId) {
  return record.fromAccount === accountId || record.toAccount === accountId;
}

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  ACCOUNT_RULES,
  createTransactionRecord,
  serializeTransaction,
  signedAmountFor,
  touchesAccount,
};
