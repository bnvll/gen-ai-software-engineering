'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateCreateInput, validateUpdateInput } = require('../src/validators/ticketValidator');
const { ValidationError } = require('../src/utils/errors');

describe('ticket model validation', () => {
  const valid = {
    customer_id: 'CUS-1',
    customer_email: 'user@example.com',
    customer_name: 'User',
    subject: 'Need help with billing',
    description: 'I have a question about my latest invoice please.',
  };

  it('accepts a complete valid payload', () => {
    const result = validateCreateInput(valid);
    assert.equal(result.customer_email, 'user@example.com');
    assert.equal(result.status, 'new');
  });

  it('rejects an invalid email', () => {
    assert.throws(
      () => validateCreateInput({ ...valid, customer_email: 'not-an-email' }),
      (error) => error instanceof ValidationError && error.details.some((d) => d.field === 'customer_email'),
    );
  });

  it('rejects a subject longer than 200 characters', () => {
    assert.throws(
      () => validateCreateInput({ ...valid, subject: 'x'.repeat(201) }),
      (error) => error.details.some((d) => d.field === 'subject'),
    );
  });

  it('rejects a description shorter than 10 characters', () => {
    assert.throws(
      () => validateCreateInput({ ...valid, description: 'too short' }),
      (error) => error.details.some((d) => d.field === 'description'),
    );
  });

  it('rejects unknown category and priority together', () => {
    try {
      validateCreateInput({ ...valid, category: 'network', priority: 'critical' });
      assert.fail('expected validation error');
    } catch (error) {
      assert.equal(error.details.length, 2);
    }
  });

  it('rejects an unknown status', () => {
    assert.throws(
      () => validateCreateInput({ ...valid, status: 'done' }),
      (error) => error.details.some((d) => d.field === 'status'),
    );
  });

  it('normalizes tags from a comma-separated string', () => {
    const result = validateCreateInput({ ...valid, tags: 'login, password' });
    assert.deepEqual(result.tags, ['login', 'password']);
  });

  it('rejects an unknown metadata source', () => {
    assert.throws(
      () => validateCreateInput({ ...valid, metadata: { source: 'fax' } }),
      (error) => error.details.some((d) => d.field === 'metadata.source'),
    );
  });

  it('rejects empty required fields on update', () => {
    assert.throws(
      () => validateUpdateInput({ customer_name: '' }),
      (error) => error.details.some((d) => d.field === 'customer_name'),
    );
  });
});
