'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

describe('ticket API', () => {
  let api;

  before(async () => {
    api = await startTestServer();
  });

  after(async () => {
    await api.close();
  });

  it('creates a ticket with 201 and a UUID', async () => {
    const response = await api.post('/tickets', api.validTicket());
    assert.equal(response.status, 201);
    assert.match(response.body.id, /^[0-9a-f-]{36}$/i);
    assert.equal(response.headers.get('location'), `/tickets/${response.body.id}`);
    assert.equal(response.body.status, 'new');
  });

  it('lists tickets', async () => {
    const created = await api.createTicket({ subject: 'List me please now' });
    const response = await api.get('/tickets');
    assert.equal(response.status, 200);
    assert.ok(response.body.count >= 1);
    assert.ok(response.body.tickets.some((ticket) => ticket.id === created.id));
  });

  it('gets a ticket by id', async () => {
    const created = await api.createTicket({ subject: 'Fetch this ticket ok' });
    const response = await api.get(`/tickets/${created.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.subject, 'Fetch this ticket ok');
  });

  it('returns 404 for an unknown ticket', async () => {
    const response = await api.get('/tickets/00000000-0000-4000-8000-000000000000');
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'Not found');
  });

  it('updates a ticket', async () => {
    const created = await api.createTicket({ subject: 'Needs an update soon' });
    const response = await api.put(`/tickets/${created.id}`, { status: 'in_progress', assigned_to: 'simone' });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'in_progress');
    assert.equal(response.body.assigned_to, 'simone');
  });

  it('logs a manual category override', async () => {
    const created = await api.createTicket({ subject: 'Override category here' });
    const response = await api.put(`/tickets/${created.id}`, { category: 'billing_question' });
    assert.equal(response.status, 200);
    assert.equal(response.body.category, 'billing_question');
    assert.ok(response.body.classification_log.some((entry) => entry.source === 'manual_override'));
  });

  it('deletes a ticket with 204', async () => {
    const created = await api.createTicket({ subject: 'Delete this ticket now' });
    const deleted = await api.del(`/tickets/${created.id}`);
    assert.equal(deleted.status, 204);
    const missing = await api.get(`/tickets/${created.id}`);
    assert.equal(missing.status, 404);
  });

  it('filters by status', async () => {
    await api.createTicket({ subject: 'Resolved already here', status: 'resolved' });
    const response = await api.get('/tickets?status=resolved');
    assert.equal(response.status, 200);
    assert.ok(response.body.tickets.length >= 1);
    assert.ok(response.body.tickets.every((ticket) => ticket.status === 'resolved'));
  });

  it('rejects invalid filter enums with 400', async () => {
    const response = await api.get('/tickets?priority=critical');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Validation failed');
  });

  it('auto-classifies through the dedicated endpoint', async () => {
    const created = await api.createTicket({
      subject: 'Production down in payments',
      description: 'The payments API is production down and customers cannot complete checkout at all.',
      auto_classify: false,
      category: 'other',
      priority: 'low',
    });
    const response = await api.post(`/tickets/${created.id}/auto-classify`);
    assert.equal(response.status, 200);
    assert.equal(response.body.priority, 'urgent');
    assert.ok(response.body.confidence >= 0 && response.body.confidence <= 1);
    assert.ok(Array.isArray(response.body.keywords_found));
    assert.ok(response.body.reasoning.length > 0);
  });

  it('returns service index and health', async () => {
    const index = await api.get('/api');
    const health = await api.get('/health');
    assert.equal(index.status, 200);
    assert.ok(index.body.endpoints.length >= 7);
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
  });

  it('returns JSON 404 for an unknown API route', async () => {
    const response = await api.get('/tickets/not-a-uuid/extra');
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'Not found');
  });
});
