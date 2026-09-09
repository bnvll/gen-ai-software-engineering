'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { readConfigFromEnv, DEFAULTS } = require('../src/middleware/rateLimit');

test('requests beyond the limit get 429 with Retry-After', async (t) => {
  const api = await startTestServer({ rateLimit: { enabled: true, max: 3, windowMs: 60_000 } });
  t.after(() => api.close());

  const allowed = [];
  for (let i = 0; i < 3; i += 1) allowed.push(await api.get('/health'));
  assert.deepEqual(allowed.map((response) => response.status), [200, 200, 200]);
  assert.deepEqual(allowed.map((response) => response.headers.get('x-ratelimit-remaining')), ['2', '1', '0']);

  const blocked = await api.get('/health');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'Too Many Requests');
  assert.match(blocked.body.message, /Rate limit of 3 requests per 60s exceeded/);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(blocked.headers.get('x-ratelimit-limit'), '3');
});

test('the counter resets once the window elapses', async (t) => {
  const api = await startTestServer({ rateLimit: { enabled: true, max: 1, windowMs: 50 } });
  t.after(() => api.close());

  assert.equal((await api.get('/health')).status, 200);
  assert.equal((await api.get('/health')).status, 429);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal((await api.get('/health')).status, 200, 'a new window starts with a fresh budget');
});

test('rate limiting applies to writes as well as reads', async (t) => {
  const api = await startTestServer({ rateLimit: { enabled: true, max: 1, windowMs: 60_000 } });
  t.after(() => api.close());

  assert.equal((await api.get('/health')).status, 200);
  const blocked = await api.post('/transactions', {
    fromAccount: 'ACC-12345', toAccount: 'ACC-67890', amount: 10, currency: 'USD', type: 'transfer',
  });
  assert.equal(blocked.status, 429);
  assert.equal(api.store.size, 0, 'a throttled request never reaches the store');
});

test('the limiter can be switched off entirely', async (t) => {
  const api = await startTestServer({ rateLimit: { enabled: false } });
  t.after(() => api.close());

  for (let i = 0; i < 20; i += 1) {
    assert.equal((await api.get('/health')).status, 200);
  }
});

test('configuration comes from the environment with safe fallbacks', () => {
  assert.deepEqual(readConfigFromEnv({}), {
    enabled: true,
    max: DEFAULTS.max,
    windowMs: DEFAULTS.windowMs,
  });
  assert.deepEqual(readConfigFromEnv({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_MS: '1000' }), {
    enabled: false,
    max: 5,
    windowMs: 1000,
  });
  assert.deepEqual(readConfigFromEnv({ RATE_LIMIT_MAX: 'abc', RATE_LIMIT_WINDOW_MS: '-1' }), {
    enabled: true,
    max: DEFAULTS.max,
    windowMs: DEFAULTS.windowMs,
  }, 'nonsense values fall back to the defaults');
});

test('the default budget is 100 requests per minute', () => {
  assert.equal(DEFAULTS.max, 100);
  assert.equal(DEFAULTS.windowMs, 60_000);
});
