'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');

/** A small ledger that covers every filter dimension. */
const LEDGER = [
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-12345', amount: 500, currency: 'USD', timestamp: '2024-01-03T09:00:00Z' },
  { type: 'transfer', fromAccount: 'ACC-12345', toAccount: 'ACC-67890', amount: 100.5, currency: 'USD', timestamp: '2024-01-15T09:00:00Z' },
  { type: 'withdrawal', fromAccount: 'ACC-12345', toAccount: undefined, amount: 20, currency: 'USD', timestamp: '2024-01-31T23:59:59Z' },
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-67890', amount: 300, currency: 'EUR', timestamp: '2024-02-10T09:00:00Z', status: 'pending' },
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-A1B2C', amount: 900, currency: 'EUR', timestamp: '2023-12-31T23:00:00Z' },
];

async function ledgerServer(t) {
  const api = await startTestServer({ seed: LEDGER });
  t.after(() => api.close());
  return api;
}

test('filter by account matches both sides of a transaction', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?accountId=ACC-67890');
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 2);
  assert.ok(response.body.every((txn) => txn.fromAccount === 'ACC-67890' || txn.toAccount === 'ACC-67890'));
});

test('filter by account is case insensitive', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?accountId=acc-12345');
  assert.equal(response.body.length, 3);
});

test('filter by type', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?type=deposit');
  assert.equal(response.body.length, 3);
  assert.ok(response.body.every((txn) => txn.type === 'deposit'));
});

test('filter by date range is inclusive on both ends', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?from=2024-01-01&to=2024-01-31');
  assert.equal(response.body.length, 3);
  assert.deepEqual(response.body.map((txn) => txn.timestamp), [
    '2024-01-31T23:59:59.000Z',
    '2024-01-15T09:00:00.000Z',
    '2024-01-03T09:00:00.000Z',
  ]);
});

test('a bare date in `to` covers the whole UTC day', async (t) => {
  const api = await ledgerServer(t);

  const sameDay = await api.get('/transactions?from=2024-01-31&to=2024-01-31');
  assert.equal(sameDay.body.length, 1);
  assert.equal(sameDay.body[0].timestamp, '2024-01-31T23:59:59.000Z');
});

test('date range accepts full ISO 8601 datetimes', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?from=2024-01-15T09:00:00Z&to=2024-01-15T09:00:01Z');
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].type, 'transfer');
});

test('filters can be combined', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?accountId=ACC-12345&type=transfer&from=2024-01-01&to=2024-01-31');
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].toAccount, 'ACC-67890');

  const empty = await api.get('/transactions?accountId=ACC-A1B2C&type=transfer');
  assert.deepEqual(empty.body, []);
});

test('filter by status and by currency', async (t) => {
  const api = await ledgerServer(t);

  const pending = await api.get('/transactions?status=pending');
  assert.equal(pending.body.length, 1);

  const eur = await api.get('/transactions?currency=EUR');
  assert.equal(eur.body.length, 2);
});

test('invalid filter values return 400 with per-field messages', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?accountId=nope&type=wire&status=settled&from=15/01/2024&currency=XYZ');
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Validation failed');
  assert.deepEqual(response.body.details.map((detail) => detail.field), [
    'accountId', 'type', 'status', 'currency', 'from',
  ]);
});

test('`to` earlier than `from` is rejected', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?from=2024-02-01&to=2024-01-01');
  assert.equal(response.status, 400);
  assert.equal(response.body.details[0].field, 'to');
});

test('a repeated filter parameter is rejected instead of silently coerced', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?type=deposit&type=transfer');
  assert.equal(response.status, 400);
  assert.match(response.body.details[0].message, /at most once/);
});

test('unknown query parameters are ignored', async (t) => {
  const api = await ledgerServer(t);

  const response = await api.get('/transactions?limit=1&sort=amount');
  assert.equal(response.status, 200);
  assert.equal(response.body.length, LEDGER.length);
});
