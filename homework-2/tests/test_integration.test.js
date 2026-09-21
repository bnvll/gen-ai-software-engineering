'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

describe('integration workflows', () => {
  let api;

  before(async () => {
    api = await startTestServer();
  });

  after(async () => {
    await api.close();
  });

  it('runs a complete ticket lifecycle', async () => {
    const created = await api.post('/tickets?auto_classify=true', api.validTicket({
      subject: 'I cannot access payroll',
      description: "Can't access the payroll portal after the password reset yesterday evening.",
    }));
    assert.equal(created.status, 201);
    assert.equal(created.body.category, 'account_access');

    const started = await api.put(`/tickets/${created.body.id}`, { status: 'in_progress', assigned_to: 'agent-1' });
    assert.equal(started.body.status, 'in_progress');

    const waiting = await api.put(`/tickets/${created.body.id}`, { status: 'waiting_customer' });
    assert.equal(waiting.body.status, 'waiting_customer');

    const resolved = await api.put(`/tickets/${created.body.id}`, { status: 'resolved' });
    assert.equal(resolved.body.status, 'resolved');
    assert.ok(resolved.body.resolved_at);

    const closed = await api.put(`/tickets/${created.body.id}`, { status: 'closed' });
    assert.equal(closed.body.status, 'closed');
  });

  it('imports JSON and auto-classifies each row', async () => {
    const payload = [
      {
        customer_id: 'CUS-A',
        customer_email: 'a@example.com',
        customer_name: 'Ann',
        subject: 'Need a refund',
        description: 'Please refund the duplicate invoice payment from last week.',
      },
      {
        customer_id: 'CUS-B',
        customer_email: 'b@example.com',
        customer_name: 'Ben',
        subject: 'App crash',
        description: 'The desktop app crash happens with an exception during export.',
      },
    ];
    const response = await api.request('POST', '/tickets/import?auto_classify=true', {
      raw: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.body.successful, 2);
    assert.equal(response.body.tickets[0].category, 'billing_question');
    assert.equal(response.body.tickets[1].category, 'technical_issue');
    assert.ok(response.body.tickets[0].classification.confidence);
  });

  it('supports combined category and priority filters', async () => {
    await api.post('/tickets', api.validTicket({
      subject: 'Urgent login failure today',
      description: 'Password login is broken and this is critical for the whole office.',
      category: 'account_access',
      priority: 'urgent',
    }));
    await api.post('/tickets', api.validTicket({
      subject: 'Low priority billing note',
      description: 'Minor question about the wording on last month invoice copy.',
      category: 'billing_question',
      priority: 'low',
    }));
    const response = await api.get('/tickets?category=account_access&priority=urgent');
    assert.ok(response.body.tickets.length >= 1);
    assert.ok(response.body.tickets.every((ticket) => (
      ticket.category === 'account_access' && ticket.priority === 'urgent'
    )));
  });

  it('reopens a resolved ticket and clears resolved_at', async () => {
    const created = await api.createTicket({ subject: 'Reopen after resolve ok' });
    await api.put(`/tickets/${created.id}`, { status: 'resolved' });
    const reopened = await api.put(`/tickets/${created.id}`, { status: 'in_progress' });
    assert.equal(reopened.body.resolved_at, null);
  });

  it('serves the agent UI', async () => {
    const response = await api.get('/');
    assert.equal(response.status, 200);
    assert.match(String(response.body), /Support desk/);
  });
});
