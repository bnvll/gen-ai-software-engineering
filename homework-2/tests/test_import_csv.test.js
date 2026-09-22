'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { parseCsv } = require('../src/services/importer');

const fixtures = path.join(__dirname, 'fixtures');

describe('CSV import', () => {
  let api;

  before(async () => {
    api = await startTestServer();
  });

  after(async () => {
    await api.close();
  });

  it('parses a header row into records', () => {
    const records = parseCsv('customer_id,subject\nCUS-1,Hello there world\n');
    assert.equal(records.length, 1);
    assert.equal(records[0].row.customer_id, 'CUS-1');
  });

  it('imports a valid CSV file', async () => {
    const csv = fs.readFileSync(path.join(fixtures, 'valid.csv'), 'utf8');
    const response = await api.request('POST', '/tickets/import?auto_classify=true', {
      raw: csv,
      headers: { 'Content-Type': 'text/csv' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.format, 'csv');
    assert.equal(response.body.successful, 2);
    assert.equal(response.body.failed, 0);
  });

  it('reports row-level validation errors without aborting the batch', async () => {
    const csv = fs.readFileSync(path.join(fixtures, 'invalid.csv'), 'utf8');
    const response = await api.request('POST', '/tickets/import', {
      raw: csv,
      headers: { 'Content-Type': 'text/csv' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.failed, 1);
    assert.equal(response.body.successful, 1);
    assert.ok(response.body.errors[0].details.length >= 1);
  });

  it('rejects an empty CSV', async () => {
    const response = await api.request('POST', '/tickets/import', {
      raw: '   ',
      headers: { 'Content-Type': 'text/csv' },
    });
    assert.equal(response.status, 400);
  });

  it('handles quoted commas in CSV fields', () => {
    const records = parseCsv('customer_id,description\nCUS-1,"Hello, please help with this issue now"\n');
    assert.equal(records[0].row.description, 'Hello, please help with this issue now');
  });

  it('imports via multipart file field', async () => {
    const csv = fs.readFileSync(path.join(fixtures, 'valid.csv'));
    const boundary = '----testboundary';
    const raw = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="valid.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      csv,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await api.request('POST', '/tickets/import', {
      raw,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.format, 'csv');
    assert.ok(response.body.successful >= 1);
  });
});
