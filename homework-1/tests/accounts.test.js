'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');

/**
 * ACC-12345 (USD): +5000 deposit, -100.50 transfer out, -250 withdrawal,
 *                  +300.25 transfer in            => 4949.75
 *                  (+75 pending and -40 failed are ignored)
 * ACC-12345 (JPY): +15000 deposit                 => 15000
 * ACC-67890 (USD): +100.50 in, +1200 deposit, -300.25 out => 1000.25
 */
const LEDGER = [
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-12345', amount: 5000, currency: 'USD', timestamp: '2024-01-03T09:00:00Z' },
  { type: 'transfer', fromAccount: 'ACC-12345', toAccount: 'ACC-67890', amount: 100.5, currency: 'USD', timestamp: '2024-01-05T09:00:00Z' },
  { type: 'withdrawal', fromAccount: 'ACC-12345', toAccount: undefined, amount: 250, currency: 'USD', timestamp: '2024-01-08T09:00:00Z' },
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-67890', amount: 1200, currency: 'USD', timestamp: '2024-01-10T09:00:00Z' },
  { type: 'transfer', fromAccount: 'ACC-67890', toAccount: 'ACC-12345', amount: 300.25, currency: 'USD', timestamp: '2024-01-14T09:00:00Z' },
  { type: 'transfer', fromAccount: 'ACC-12345', toAccount: 'ACC-A1B2C', amount: 75, currency: 'USD', timestamp: '2024-01-20T09:00:00Z', status: 'pending' },
  { type: 'withdrawal', fromAccount: 'ACC-12345', toAccount: undefined, amount: 40, currency: 'USD', timestamp: '2024-01-22T09:00:00Z', status: 'failed' },
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-12345', amount: 15000, currency: 'JPY', timestamp: '2024-02-05T09:00:00Z' },
];

async function ledgerServer(t) {
  const api = await startTestServer({ seed: LEDGER });
  t.after(() => api.close());
  return api;
}

test('GET /accounts/:id/balance reports a balance per currency', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-12345/balance');
  assert.equal(response.status, 200);
  assert.equal(response.body.accountId, 'ACC-12345');
  assert.deepEqual(response.body.balances, [
    { currency: 'JPY', balance: 15000, credits: 15000, debits: 0, transactionCount: 1 },
    { currency: 'USD', balance: 4949.75, credits: 5300.25, debits: 350.5, transactionCount: 4 },
  ]);
});

test('GET /accounts/:id/balance?currency= reports a single currency', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-12345/balance?currency=usd');
  assert.equal(response.body.currency, 'USD');
  assert.equal(response.body.balance, 4949.75);
  assert.equal(response.body.balances, undefined);
});

test('balance ignores pending and failed transactions', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-A1B2C/balance');
  // ACC-A1B2C is only referenced by a pending transfer, so it has no balance.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.balances, []);
});

test('transfers debit one account and credit the other', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-67890/balance?currency=USD');
  assert.equal(response.body.balance, 1000.25);
  assert.equal(response.body.credits, 1300.5);
  assert.equal(response.body.debits, 300.25);
});

test('GET /accounts/:id/balance returns 404 for an unknown account', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-99999/balance');
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'Not found');
});

test('GET /accounts/:id/balance returns 400 for a malformed account number', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/12345/balance');
  assert.equal(response.status, 400);
  assert.equal(response.body.details[0].field, 'accountId');
});

test('GET /accounts/:id/summary totals deposits, withdrawals and transfers', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-12345/summary');
  assert.equal(response.status, 200);
  assert.equal(response.body.transactionCount, 7, 'counts every status');
  assert.deepEqual(response.body.statusBreakdown, { completed: 5, pending: 1, failed: 1 });
  assert.equal(response.body.mostRecentTransactionDate, '2024-02-05T09:00:00.000Z');

  const usd = response.body.totals.find((entry) => entry.currency === 'USD');
  assert.deepEqual(usd, {
    currency: 'USD',
    totalDeposits: 5000,
    totalWithdrawals: 250,
    totalTransfersIn: 300.25,
    totalTransfersOut: 100.5,
    netChange: 4949.75,
    transactionCount: 4,
    mostRecentTransactionDate: '2024-01-14T09:00:00.000Z',
  });
});

test('GET /accounts/:id/summary?currency= narrows the totals', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-12345/summary?currency=JPY');
  assert.equal(response.body.totals.length, 1);
  assert.equal(response.body.totals[0].totalDeposits, 15000);
});

test('GET /accounts/:id/interest computes simple interest', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-67890/interest?rate=0.05&days=30');
  assert.equal(response.status, 200);
  assert.deepEqual(
    { ...response.body, asOf: undefined },
    {
      accountId: 'ACC-67890',
      currency: 'USD',
      principal: 1000.25,
      annualRate: 0.05,
      days: 30,
      dayCountBasis: 365,
      // 1000.25 * 0.05 * 30 / 365 = 4.1106... -> 4.11
      interest: 4.11,
      projectedBalance: 1004.36,
      asOf: undefined,
    },
  );
});

test('interest requires ?currency= when the account holds several currencies', async (t) => {
  const api = await ledgerServer(t);

  const ambiguous = await api.get('/accounts/ACC-12345/interest?rate=0.05&days=30');
  assert.equal(ambiguous.status, 400);
  assert.match(ambiguous.body.message, /several currencies/);

  const explicit = await api.get('/accounts/ACC-12345/interest?rate=0.05&days=30&currency=USD');
  assert.equal(explicit.status, 200);
  assert.equal(explicit.body.principal, 4949.75);
});

test('interest validates rate and days', async (t) => {
  const api = await ledgerServer(t);

  const missing = await api.get('/accounts/ACC-67890/interest');
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.details.map((detail) => detail.field), ['rate', 'days']);

  const outOfRange = await api.get('/accounts/ACC-67890/interest?rate=5&days=1.5');
  assert.equal(outOfRange.status, 400);
  assert.match(outOfRange.body.details[0].message, /decimal fraction/);
  assert.match(outOfRange.body.details[1].message, /whole number/);
});

test('a zero rate accrues no interest', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/accounts/ACC-67890/interest?rate=0&days=365');
  assert.equal(response.body.interest, 0);
  assert.equal(response.body.projectedBalance, 1000.25);
});

test('an overdrawn account accrues negative interest', async (t) => {
  const api = await ledgerServer(t);

  // A withdrawal with no matching deposit leaves the account overdrawn.
  await api.createTransaction({
    type: 'withdrawal',
    fromAccount: 'ACC-OVER1',
    toAccount: undefined,
    amount: 500,
    currency: 'USD',
  });

  const balance = await api.get('/accounts/ACC-OVER1/balance?currency=USD');
  assert.equal(balance.body.balance, -500);

  const response = await api.get('/accounts/ACC-OVER1/interest?rate=0.05&days=30');
  assert.equal(response.status, 200);
  assert.equal(response.body.principal, -500);
  // -500 * 0.05 * 30 / 365 = -2.0547... -> -2.05
  assert.equal(response.body.interest, -2.05);
  assert.equal(response.body.projectedBalance, -502.05);
});

test('interest rounds half away from zero, not towards positive infinity', async (t) => {
  const api = await ledgerServer(t);

  // Balance -1.01 => -101 minor units. At 50% for 365 days the raw interest is
  // exactly -50.5 minor units: the half-way case.
  await api.createTransaction({
    type: 'withdrawal',
    fromAccount: 'ACC-HALF1',
    toAccount: undefined,
    amount: 1.01,
    currency: 'USD',
  });

  const response = await api.get('/accounts/ACC-HALF1/interest?rate=0.5&days=365');
  assert.equal(response.body.principal, -1.01);
  // Math.round(-50.5) would give -50 (JS rounds halves towards +Infinity),
  // which would understate the debit. The sign is applied separately so the
  // magnitude rounds up: -51 minor units.
  assert.equal(response.body.interest, -0.51);
  assert.equal(response.body.projectedBalance, -1.52);
});
