'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');

test('POST /transactions creates a transaction', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.post('/transactions', {
    fromAccount: 'ACC-12345',
    toAccount: 'ACC-67890',
    amount: 100.5,
    currency: 'USD',
    type: 'transfer',
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('location'), `/transactions/${response.body.id}`);
  assert.deepEqual(Object.keys(response.body).sort(), [
    'amount', 'currency', 'fromAccount', 'id', 'status', 'timestamp', 'toAccount', 'type',
  ]);
  assert.equal(response.body.amount, 100.5);
  assert.equal(response.body.currency, 'USD');
  assert.equal(response.body.status, 'completed', 'status defaults to completed');
  assert.match(response.body.id, /^[0-9a-f-]{36}$/);
  assert.equal(response.body.timestamp, new Date(response.body.timestamp).toISOString());
});

test('POST /transactions normalizes account numbers and currency to upper case', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const created = await api.createTransaction({
    fromAccount: 'acc-12345',
    toAccount: 'acc-a1b2c',
    currency: 'usd',
  });

  assert.equal(created.fromAccount, 'ACC-12345');
  assert.equal(created.toAccount, 'ACC-A1B2C');
  assert.equal(created.currency, 'USD');
});

test('POST /transactions accepts an explicit timestamp and status', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const created = await api.createTransaction({
    timestamp: '2024-01-15T10:30:00Z',
    status: 'pending',
  });

  assert.equal(created.timestamp, '2024-01-15T10:30:00.000Z');
  assert.equal(created.status, 'pending');
});

test('POST /transactions treats a timestamp without offset as UTC', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const created = await api.createTransaction({ timestamp: '2024-01-15T10:30:00' });
  assert.equal(created.timestamp, '2024-01-15T10:30:00.000Z');
});

test('every transaction gets a unique id', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const ids = new Set();
  for (let i = 0; i < 25; i += 1) {
    ids.add((await api.createTransaction()).id);
  }
  assert.equal(ids.size, 25);
});

test('GET /transactions lists every transaction, newest first', async (t) => {
  const api = await startTestServer({
    seed: [
      { timestamp: '2024-01-05T00:00:00Z' },
      { timestamp: '2024-01-20T00:00:00Z' },
      { timestamp: '2024-01-10T00:00:00Z' },
    ],
  });
  t.after(() => api.close());

  const response = await api.get('/transactions');
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 3);
  assert.deepEqual(response.body.map((txn) => txn.timestamp), [
    '2024-01-20T00:00:00.000Z',
    '2024-01-10T00:00:00.000Z',
    '2024-01-05T00:00:00.000Z',
  ]);
});

test('GET /transactions returns an empty array when the ledger is empty', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.get('/transactions');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
});

test('GET /transactions/:id returns the transaction', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const created = await api.createTransaction();
  const response = await api.get(`/transactions/${created.id}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, created);
});

test('GET /transactions/:id returns 404 for an unknown id', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.get('/transactions/2f1c9a52-0000-4000-8000-000000000000');
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'Not found');
  assert.match(response.body.message, /not found/i);
});

test('unknown routes return a JSON 404', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.get('/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'Not found');
});

test('malformed JSON returns 400 rather than crashing', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.request('POST', '/transactions', {
    body: '{"amount": ',
    headers: { 'Content-Type': 'application/json' },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Bad request');
  assert.match(response.body.message, /valid JSON/i);
});

test('POST without a JSON content type returns 415', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.request('POST', '/transactions', {
    body: 'amount=100',
    headers: { 'Content-Type': 'text/plain' },
  });

  assert.equal(response.status, 415);
  assert.match(response.body.message, /application\/json/);
});

test('POST with a JSON content type but no body returns 400', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.request('POST', '/transactions', {
    headers: { 'Content-Type': 'application/json' },
  });

  // Clients that omit the body entirely (curl) are told the body is missing;
  // clients that send a zero-length body (fetch) reach the validator and are
  // told which fields are required. Either way it is an explanatory 400.
  assert.equal(response.status, 400);
  const explanation = response.body.message ?? JSON.stringify(response.body.details);
  assert.match(explanation, /required/i);
});

test('POST with an oversized body returns 413', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.request('POST', '/transactions', {
    body: JSON.stringify({ type: 'deposit', toAccount: 'ACC-12345', amount: 1, currency: 'USD', pad: 'x'.repeat(70_000) }),
    headers: { 'Content-Type': 'application/json' },
  });

  assert.equal(response.status, 413);
  assert.equal(response.body.error, 'Payload too large');
});

test('GET / describes the available endpoints and GET /health reports status', async (t) => {
  const api = await startTestServer({ seed: [{}] });
  t.after(() => api.close());

  const index = await api.get('/');
  assert.equal(index.status, 200);
  assert.equal(index.body.name, 'Banking Transactions API');
  assert.ok(index.body.endpoints.some((entry) => entry.path === '/transactions'));
  assert.deepEqual(index.body.enums.type, ['deposit', 'withdrawal', 'transfer']);

  const health = await api.get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.transactionCount, 1);
});
