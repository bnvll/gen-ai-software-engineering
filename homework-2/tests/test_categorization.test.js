'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyTicket } = require('../src/services/classifier');

describe('categorization', () => {
  it('classifies login and password issues as account_access', () => {
    const result = classifyTicket({
      subject: 'Password reset failed',
      description: 'I cannot log in after enabling 2FA on my account.',
    });
    assert.equal(result.category, 'account_access');
    assert.ok(result.keywords_found.includes('password') || result.keywords_found.includes('log in'));
  });

  it('classifies invoices as billing_question', () => {
    const result = classifyTicket({
      subject: 'Invoice looks wrong',
      description: 'I was charged twice and need a refund on the last payment.',
    });
    assert.equal(result.category, 'billing_question');
  });

  it('classifies enhancements as feature_request', () => {
    const result = classifyTicket({
      subject: 'Feature request for exports',
      description: 'It would be nice if we could export reports as CSV. Please add this enhancement.',
    });
    assert.equal(result.category, 'feature_request');
  });

  it('classifies defects with reproduction steps as bug_report', () => {
    const result = classifyTicket({
      subject: 'Bug in the checkout',
      description: 'Unexpected behavior when paying. Steps to reproduce: open cart, click pay.',
    });
    assert.equal(result.category, 'bug_report');
  });

  it('classifies crashes as technical_issue', () => {
    const result = classifyTicket({
      subject: 'App crash on launch',
      description: 'The mobile app throws an exception and a stack trace after the splash screen.',
    });
    assert.equal(result.category, 'technical_issue');
  });

  it('falls back to other when nothing matches', () => {
    const result = classifyTicket({
      subject: 'Hello from a customer',
      description: 'Just checking whether anyone is reading these tickets today.',
    });
    assert.equal(result.category, 'other');
    assert.equal(result.priority, 'medium');
  });

  it('marks production down as urgent', () => {
    const result = classifyTicket({
      subject: 'Production down',
      description: 'Payments are production down since 09:00 and this is critical.',
    });
    assert.equal(result.priority, 'urgent');
  });

  it('marks blocking work as high', () => {
    const result = classifyTicket({
      subject: 'This is blocking our release',
      description: 'We need this fixed asap because it is blocking QA.',
    });
    assert.equal(result.priority, 'high');
  });

  it('marks cosmetic items as low', () => {
    const result = classifyTicket({
      subject: 'Minor cosmetic issue',
      description: 'A minor alignment problem on the settings page, purely cosmetic.',
    });
    assert.equal(result.priority, 'low');
  });

  it('returns a confidence between 0 and 1 and a reasoning string', () => {
    const result = classifyTicket({
      subject: 'Security concern',
      description: 'Possible security exposure on the login page that I cannot access after rotating keys.',
    });
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.equal(typeof result.reasoning, 'string');
    assert.ok(result.keywords_found.includes('security'));
  });
});
