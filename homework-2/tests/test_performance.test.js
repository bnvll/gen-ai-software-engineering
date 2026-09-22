'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const { classifyTicket } = require('../src/services/classifier');

describe('performance', () => {
  let api;

  before(async () => {
    api = await startTestServer();
  });

  after(async () => {
    await api.close();
  });

  it('handles 20+ concurrent creates', async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) => api.post('/tickets', api.validTicket({
        subject: `Concurrent ticket number ${index} here`,
        customer_email: `user${index}@example.com`,
      }))),
    );
    const elapsed = Date.now() - started;
    assert.ok(results.every((result) => result.status === 201));
    assert.ok(elapsed < 3000, `expected < 3s, took ${elapsed}ms`);
  });

  it('lists tickets after a larger insert batch', async () => {
    const started = Date.now();
    const response = await api.get('/tickets');
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    assert.ok(response.body.count >= 25);
    assert.ok(elapsed < 1000, `list took ${elapsed}ms`);
  });

  it('imports a 40-row JSON payload quickly', async () => {
    const tickets = Array.from({ length: 40 }, (_, index) => ({
      customer_id: `CUS-${index}`,
      customer_email: `bulk${index}@example.com`,
      customer_name: `Bulk ${index}`,
      subject: `Bulk import row ${index} subject`,
      description: 'This description is long enough for validation to pass easily.',
    }));
    const started = Date.now();
    const response = await api.request('POST', '/tickets/import', {
      raw: JSON.stringify(tickets),
      headers: { 'Content-Type': 'application/json' },
    });
    const elapsed = Date.now() - started;
    assert.equal(response.body.successful, 40);
    assert.ok(elapsed < 3000, `import took ${elapsed}ms`);
  });

  it('classifies 200 tickets in-process under 50ms', () => {
    const started = Date.now();
    for (let index = 0; index < 200; index += 1) {
      classifyTicket({
        subject: 'Password login is blocking us',
        description: 'Critical: cannot access production admin after rotation.',
      });
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 50, `classifier took ${elapsed}ms`);
  });

  it('applies combined filters without scanning timeouts', async () => {
    const started = Date.now();
    const response = await api.get('/tickets?category=other&priority=medium');
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    assert.ok(elapsed < 1000);
  });
});
