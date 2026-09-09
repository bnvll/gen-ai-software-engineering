'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');

/** Convenience: POST a payload and return { status, error, details }. */
async function post(api, payload) {
  const response = await api.post('/transactions', payload);
  return {
    status: response.status,
    error: response.body.error,
    details: response.body.details ?? [],
    /** @param {string} field */
    messageFor(field) {
      return this.details.find((detail) => detail.field === field)?.message;
    },
    fields() {
      return this.details.map((detail) => detail.field);
    },
  };
}

const VALID_TRANSFER = {
  fromAccount: 'ACC-12345',
  toAccount: 'ACC-67890',
  amount: 100.5,
  currency: 'USD',
  type: 'transfer',
};

test('amount must be a positive number', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  for (const amount of [-10, 0, -0.01]) {
    const result = await post(api, { ...VALID_TRANSFER, amount });
    assert.equal(result.status, 400, `amount ${amount} should be rejected`);
    assert.equal(result.error, 'Validation failed');
    assert.equal(result.messageFor('amount'), 'Amount must be a positive number');
  }
});

test('amount must be a JSON number, not a numeric string', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const result = await post(api, { ...VALID_TRANSFER, amount: '100.50' });
  assert.equal(result.status, 400);
  assert.equal(result.messageFor('amount'), 'Amount must be a positive number');
});

test('amount is limited to 2 decimal places', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const rejected = await post(api, { ...VALID_TRANSFER, amount: 100.555 });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.messageFor('amount'), 'Amount must have at most 2 decimal places');

  const accepted = await api.post('/transactions', { ...VALID_TRANSFER, amount: 0.01 });
  assert.equal(accepted.status, 201);
});

test('amount precision follows the currency: JPY has no minor unit', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const rejected = await post(api, { ...VALID_TRANSFER, amount: 100.5, currency: 'JPY' });
  assert.equal(rejected.status, 400);
  assert.match(rejected.messageFor('amount'), /whole number for JPY/);

  const accepted = await api.post('/transactions', { ...VALID_TRANSFER, amount: 15000, currency: 'JPY' });
  assert.equal(accepted.status, 201);
});

test('amount is stored exactly - repeated cent amounts do not drift', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  for (let i = 0; i < 3; i += 1) {
    await api.createTransaction({ type: 'deposit', fromAccount: undefined, amount: 0.1, toAccount: 'ACC-11111' });
  }
  const balance = await api.get('/accounts/ACC-11111/balance?currency=USD');
  assert.equal(balance.body.balance, 0.3, 'must not be 0.30000000000000004');
});

test('currency must be a supported ISO 4217 code', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  for (const currency of ['XYZ', 'US', 'dollars', 123] ) {
    const result = await post(api, { ...VALID_TRANSFER, currency });
    assert.equal(result.status, 400, `currency ${currency} should be rejected`);
    assert.match(result.messageFor('currency'), /Invalid currency code/);
  }
});

test('account numbers must match ACC-XXXXX', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const invalid = ['ACC-1234', 'ACC-123456', '12345', 'ACCT-12345', 'ACC_12345', 'ACC-12 45'];
  for (const fromAccount of invalid) {
    const result = await post(api, { ...VALID_TRANSFER, fromAccount });
    assert.equal(result.status, 400, `${fromAccount} should be rejected`);
    assert.match(result.messageFor('fromAccount'), /ACC-XXXXX/);
  }

  const accepted = await api.post('/transactions', { ...VALID_TRANSFER, fromAccount: 'ACC-A1B2C' });
  assert.equal(accepted.status, 201, 'alphanumeric account numbers are valid');
});

test('type must be one of deposit, withdrawal, transfer', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const result = await post(api, { ...VALID_TRANSFER, type: 'wire' });
  assert.equal(result.status, 400);
  assert.equal(result.messageFor('type'), 'Type must be one of: deposit, withdrawal, transfer');
});

test('status must be one of pending, completed, failed', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const result = await post(api, { ...VALID_TRANSFER, status: 'settled' });
  assert.equal(result.status, 400);
  assert.equal(result.messageFor('status'), 'Status must be one of: pending, completed, failed');
});

test('timestamp must be a valid ISO 8601 datetime', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  for (const timestamp of ['15/01/2024', '2024-02-31', 'yesterday', '2024-13-01T00:00:00Z']) {
    const result = await post(api, { ...VALID_TRANSFER, timestamp });
    assert.equal(result.status, 400, `${timestamp} should be rejected`);
    assert.match(result.messageFor('timestamp'), /ISO 8601/);
  }
});

test('each transaction type requires the right accounts', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  // deposit: toAccount only
  const depositMissingTo = await post(api, { amount: 10, currency: 'EUR', type: 'deposit' });
  assert.equal(depositMissingTo.messageFor('toAccount'), 'toAccount is required for deposit transactions');

  const depositWithFrom = await post(api, {
    fromAccount: 'ACC-12345', toAccount: 'ACC-67890', amount: 10, currency: 'EUR', type: 'deposit',
  });
  assert.match(depositWithFrom.messageFor('fromAccount'), /must be omitted for deposit/);

  // withdrawal: fromAccount only
  const withdrawalMissingFrom = await post(api, { amount: 10, currency: 'EUR', type: 'withdrawal' });
  assert.equal(withdrawalMissingFrom.messageFor('fromAccount'), 'fromAccount is required for withdrawal transactions');

  const withdrawalWithTo = await post(api, {
    fromAccount: 'ACC-12345', toAccount: 'ACC-67890', amount: 10, currency: 'EUR', type: 'withdrawal',
  });
  assert.match(withdrawalWithTo.messageFor('toAccount'), /must be omitted for withdrawal/);

  // transfer: both, and they must differ
  const transferMissingBoth = await post(api, { amount: 10, currency: 'EUR', type: 'transfer' });
  assert.deepEqual(transferMissingBoth.fields(), ['fromAccount', 'toAccount']);

  const selfTransfer = await post(api, { ...VALID_TRANSFER, toAccount: 'ACC-12345' });
  assert.equal(selfTransfer.messageFor('toAccount'), 'toAccount must be different from fromAccount');
});

test('all field errors are reported in a single response', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const result = await post(api, {
    fromAccount: 'ACC-1',
    toAccount: 'ACC-67890',
    amount: -5.999,
    currency: 'XYZ',
    type: 'transfer',
    status: 'nope',
  });

  assert.equal(result.status, 400);
  assert.equal(result.error, 'Validation failed');
  assert.deepEqual(result.fields(), ['fromAccount', 'currency', 'amount', 'status']);
});

test('an empty body reports every required field', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const result = await post(api, {});
  assert.equal(result.status, 400);
  assert.deepEqual(result.fields(), ['type', 'currency', 'amount']);
});

test('a non-object body is rejected', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const result = await post(api, ['not', 'an', 'object']);
  assert.equal(result.status, 400);
  assert.equal(result.messageFor('body'), 'Request body must be a JSON object');
});

test('unknown fields in the payload are ignored', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.post('/transactions', { ...VALID_TRANSFER, reference: 'INV-42', id: 'client-supplied' });
  assert.equal(response.status, 201);
  assert.notEqual(response.body.id, 'client-supplied', 'ids are always server generated');
  assert.equal(response.body.reference, undefined);
});
