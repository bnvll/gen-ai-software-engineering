'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { toCsv, escapeCsvField, CSV_COLUMNS } = require('../src/services/csvExporter');

const LEDGER = [
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-12345', amount: 5000, currency: 'USD', timestamp: '2024-01-03T09:00:00Z' },
  { type: 'transfer', fromAccount: 'ACC-12345', toAccount: 'ACC-67890', amount: 100.5, currency: 'USD', timestamp: '2024-01-05T09:00:00Z' },
  { type: 'deposit', fromAccount: undefined, toAccount: 'ACC-A1B2C', amount: 900, currency: 'EUR', timestamp: '2024-02-10T09:00:00Z' },
];

test('GET /transactions/export returns CSV with a header row', async (t) => {
  const api = await startTestServer({ seed: LEDGER });
  t.after(() => api.close());

  const response = await api.get('/transactions/export?format=csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"/);

  const lines = response.body.trim().split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines.length, 4, 'header + 3 rows');
  // Newest first, amounts written with the currency's own precision.
  assert.match(lines[1], /,ACC-A1B2C,900\.00,EUR,deposit,/);
  assert.match(lines[2], /ACC-12345,ACC-67890,100\.50,USD,transfer,/);
});

test('CSV export defaults to csv and honours the list filters', async (t) => {
  const api = await startTestServer({ seed: LEDGER });
  t.after(() => api.close());

  const response = await api.get('/transactions/export?accountId=ACC-A1B2C');
  assert.match(response.headers.get('content-type'), /^text\/csv/);
  assert.equal(response.body.trim().split('\r\n').length, 2, 'header + 1 filtered row');
});

test('CSV export leaves the unused account column empty', async (t) => {
  const api = await startTestServer({ seed: [LEDGER[0]] });
  t.after(() => api.close());

  const response = await api.get('/transactions/export');
  const [, row] = response.body.trim().split('\r\n');
  const [, fromAccount, toAccount] = row.split(',');
  assert.equal(fromAccount, '', 'a deposit has no fromAccount');
  assert.equal(toAccount, 'ACC-12345');
});

test('export supports format=json and rejects anything else', async (t) => {
  const api = await startTestServer({ seed: LEDGER });
  t.after(() => api.close());

  const json = await api.get('/transactions/export?format=JSON');
  assert.equal(json.status, 200);
  assert.equal(json.body.length, 3);

  const invalid = await api.get('/transactions/export?format=pdf');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.details[0].field, 'format');
});

test('export of an empty ledger still returns the header row', async (t) => {
  const api = await startTestServer();
  t.after(() => api.close());

  const response = await api.get('/transactions/export');
  assert.equal(response.body, `${CSV_COLUMNS.join(',')}\r\n`);
});

test('the export route is not shadowed by GET /transactions/:id', async (t) => {
  const api = await startTestServer({ seed: LEDGER });
  t.after(() => api.close());

  const response = await api.get('/transactions/export');
  assert.equal(response.status, 200, '"export" must not be read as a transaction id');
});

test('csv fields are escaped per RFC 4180', () => {
  assert.equal(escapeCsvField('plain'), 'plain');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField('line\nbreak'), '"line\nbreak"');
  assert.equal(escapeCsvField(null), '');
});

test('toCsv renders zero-decimal currencies without a decimal point', () => {
  const csv = toCsv([{
    id: 'abc', fromAccount: null, toAccount: 'ACC-12345', amountMinor: 15000,
    currency: 'JPY', type: 'deposit', timestamp: '2024-02-05T09:00:00.000Z', status: 'completed',
  }]);
  assert.match(csv, /abc,,ACC-12345,15000,JPY,deposit/);
});
