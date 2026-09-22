'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { parseXml } = require('../src/services/importer');

const fixtures = path.join(__dirname, 'fixtures');

describe('XML import', () => {
  let api;

  before(async () => {
    api = await startTestServer();
  });

  after(async () => {
    await api.close();
  });

  it('extracts ticket fields and tags', () => {
    const xml = `<tickets><ticket><customer_id>1</customer_id><subject>Hi</subject><tags><tag>a</tag><tag>b</tag></tags></ticket></tickets>`;
    const records = parseXml(xml);
    assert.deepEqual(records[0].row.tags, ['a', 'b']);
  });

  it('decodes XML entities', () => {
    const xml = `<tickets><ticket><subject>A &amp; B</subject></ticket></tickets>`;
    assert.equal(parseXml(xml)[0].row.subject, 'A & B');
  });

  it('imports valid XML tickets', async () => {
    const xml = fs.readFileSync(path.join(fixtures, 'valid.xml'), 'utf8');
    const response = await api.request('POST', '/tickets/import', {
      raw: xml,
      headers: { 'Content-Type': 'application/xml' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.format, 'xml');
    assert.equal(response.body.successful, 2);
  });

  it('returns 400 for XML without tickets', async () => {
    const response = await api.request('POST', '/tickets/import', {
      raw: '<note>hello</note>',
      headers: { 'Content-Type': 'application/xml' },
    });
    assert.equal(response.status, 400);
  });

  it('returns 400 for an empty body', async () => {
    const response = await api.request('POST', '/tickets/import', {
      raw: '',
      headers: { 'Content-Type': 'application/xml' },
    });
    assert.equal(response.status, 400);
  });
});
