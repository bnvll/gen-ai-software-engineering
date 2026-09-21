'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { parseJson } = require('../src/services/importer');

const fixtures = path.join(__dirname, 'fixtures');

describe('JSON import', () => {
  let api;

  before(async () => {
    api = await startTestServer();
  });

  after(async () => {
    await api.close();
  });

  it('accepts a top-level array', () => {
    const records = parseJson('[{"customer_id":"1"}]');
    assert.equal(records.length, 1);
  });

  it('accepts a tickets wrapper object', () => {
    const records = parseJson('{"tickets":[{"customer_id":"1"},{"customer_id":"2"}]}');
    assert.equal(records.length, 2);
  });

  it('imports valid JSON tickets', async () => {
    const json = fs.readFileSync(path.join(fixtures, 'valid.json'), 'utf8');
    const response = await api.request('POST', '/tickets/import', {
      raw: json,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.format, 'json');
    assert.equal(response.body.successful, 2);
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await api.request('POST', '/tickets/import', {
      raw: '{not json',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Malformed file');
  });

  it('returns 400 for a JSON object that is not a ticket list', async () => {
    const response = await api.request('POST', '/tickets/import', {
      raw: '{"hello":"world"}',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 400);
  });
});
