'use strict';

const { ApiError, NotFoundError } = require('../utils/errors');
const { fromMinorUnits } = require('../utils/money');
const { signedAmountFor } = require('../models/transaction');
const { DAY_COUNT_BASIS } = require('../validators/queryValidator');

/**
 * Account-level read models derived from the transaction ledger.
 *
 * There is no account entity in this API: an account "exists" as soon as it
 * appears on either side of at least one transaction, so asking for an account
 * we have never seen is a 404.
 *
 * Two rules drive everything below:
 *  1. Only `completed` transactions move money. `pending` and `failed` ones are
 *     reported separately but never folded into a balance.
 *  2. Amounts in different currencies are never summed. Every figure is
 *     reported per currency.
 */

function assertAccountExists(store, accountId) {
  if (!store.hasAccount(accountId)) {
    throw new NotFoundError(`Account ${accountId} not found. No transaction references this account`);
  }
}

/** Completed transactions touching the account, newest-first. */
function completedFor(store, accountId) {
  return store.listForAccount(accountId).filter((record) => record.status === 'completed');
}

/**
 * Per-currency balance buckets in integer minor units - the internal shape all
 * money maths runs on.
 *
 * @returns {Map<string, {creditsMinor: number, debitsMinor: number, transactionCount: number}>}
 */
function balanceBucketsFor(store, accountId) {
  const buckets = new Map();

  for (const record of completedFor(store, accountId)) {
    const bucket = buckets.get(record.currency)
      ?? { creditsMinor: 0, debitsMinor: 0, transactionCount: 0 };
    const effect = signedAmountFor(record, accountId);
    if (effect >= 0) bucket.creditsMinor += effect;
    else bucket.debitsMinor += -effect;
    bucket.transactionCount += 1;
    buckets.set(record.currency, bucket);
  }
  return buckets;
}

/**
 * Balance per currency, formatted for the API.
 * @returns {{currency: string, balance: number, credits: number, debits: number,
 *            transactionCount: number}[]}
 */
function balancesFor(store, accountId) {
  return [...balanceBucketsFor(store, accountId).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, bucket]) => ({
      currency,
      balance: fromMinorUnits(bucket.creditsMinor - bucket.debitsMinor, currency),
      credits: fromMinorUnits(bucket.creditsMinor, currency),
      debits: fromMinorUnits(bucket.debitsMinor, currency),
      transactionCount: bucket.transactionCount,
    }));
}

/**
 * Picks the currency for a single-currency figure.
 *
 * @param {string[]} available currencies seen on the account
 * @param {?string} requested value of `?currency=`
 * @throws {ApiError} 400 when the account holds several currencies and the
 *   caller did not say which one they meant.
 */
function resolveCurrency(available, requested, accountId) {
  if (requested) return requested;
  if (available.length === 1) return available[0];
  if (available.length === 0) {
    throw new ApiError(
      400,
      'Bad request',
      `Account ${accountId} has no completed transactions. Pass ?currency= to select a currency`,
    );
  }
  throw new ApiError(
    400,
    'Bad request',
    `Account ${accountId} holds several currencies (${available.join(', ')}). Amounts in different currencies are never summed - pass ?currency= to select one`,
  );
}

/** GET /accounts/:accountId/balance */
function getBalance(store, accountId, requestedCurrency = null) {
  assertAccountExists(store, accountId);
  const balances = balancesFor(store, accountId);
  const asOf = new Date().toISOString();

  if (!requestedCurrency) return { accountId, balances, asOf };

  const match = balances.find((entry) => entry.currency === requestedCurrency);
  return {
    accountId,
    ...(match ?? { currency: requestedCurrency, balance: 0, credits: 0, debits: 0, transactionCount: 0 }),
    asOf,
  };
}

/**
 * GET /accounts/:accountId/summary
 *
 * Money totals cover completed transactions only; `statusBreakdown` shows what
 * was left out.
 */
function getSummary(store, accountId, requestedCurrency = null) {
  assertAccountExists(store, accountId);

  const all = store.listForAccount(accountId); // newest-first
  const statusBreakdown = { completed: 0, pending: 0, failed: 0 };
  for (const record of all) statusBreakdown[record.status] += 1;

  const perCurrency = new Map();
  for (const record of all) {
    if (record.status !== 'completed') continue;
    if (requestedCurrency && record.currency !== requestedCurrency) continue;

    const bucket = perCurrency.get(record.currency) ?? {
      depositsMinor: 0,
      withdrawalsMinor: 0,
      transfersInMinor: 0,
      transfersOutMinor: 0,
      transactionCount: 0,
      mostRecentTransactionDate: null,
    };

    if (record.type === 'deposit') bucket.depositsMinor += record.amountMinor;
    else if (record.type === 'withdrawal') bucket.withdrawalsMinor += record.amountMinor;
    else if (record.toAccount === accountId) bucket.transfersInMinor += record.amountMinor;
    else bucket.transfersOutMinor += record.amountMinor;

    bucket.transactionCount += 1;
    // `all` is newest-first, so the first record per currency is the latest one.
    bucket.mostRecentTransactionDate ??= record.timestamp;
    perCurrency.set(record.currency, bucket);
  }

  const totals = [...perCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, bucket]) => ({
      currency,
      totalDeposits: fromMinorUnits(bucket.depositsMinor, currency),
      totalWithdrawals: fromMinorUnits(bucket.withdrawalsMinor, currency),
      totalTransfersIn: fromMinorUnits(bucket.transfersInMinor, currency),
      totalTransfersOut: fromMinorUnits(bucket.transfersOutMinor, currency),
      netChange: fromMinorUnits(
        bucket.depositsMinor + bucket.transfersInMinor - bucket.withdrawalsMinor - bucket.transfersOutMinor,
        currency,
      ),
      transactionCount: bucket.transactionCount,
      mostRecentTransactionDate: bucket.mostRecentTransactionDate,
    }));

  return {
    accountId,
    transactionCount: all.length,
    mostRecentTransactionDate: all[0]?.timestamp ?? null,
    statusBreakdown,
    totals,
    asOf: new Date().toISOString(),
  };
}

/**
 * GET /accounts/:accountId/interest?rate=0.05&days=30
 *
 * Simple (non-compounding) interest on the current balance:
 *
 *   interest = balance x rate x days / 365
 *
 * The maths runs in minor units and the result is rounded to the currency's
 * minor unit, half away from zero. An overdrawn account accrues negative
 * interest, which is why the sign is preserved explicitly.
 */
function getSimpleInterest(store, accountId, { rate, days, currency = null }) {
  assertAccountExists(store, accountId);

  const buckets = balanceBucketsFor(store, accountId);
  const selected = resolveCurrency([...buckets.keys()].sort(), currency, accountId);
  const bucket = buckets.get(selected);
  const principalMinor = bucket ? bucket.creditsMinor - bucket.debitsMinor : 0;

  const rawInterestMinor = (principalMinor * rate * days) / DAY_COUNT_BASIS;
  const interestMinor = Math.sign(rawInterestMinor) * Math.round(Math.abs(rawInterestMinor));

  return {
    accountId,
    currency: selected,
    principal: fromMinorUnits(principalMinor, selected),
    annualRate: rate,
    days,
    dayCountBasis: DAY_COUNT_BASIS,
    interest: fromMinorUnits(interestMinor, selected),
    projectedBalance: fromMinorUnits(principalMinor + interestMinor, selected),
    asOf: new Date().toISOString(),
  };
}

module.exports = {
  getBalance,
  getSummary,
  getSimpleInterest,
  balancesFor,
  balanceBucketsFor,
  assertAccountExists,
};
