'use strict';

// Mute request logging before anything loads the logger.
process.env.LOG_LEVEL = 'silent';

const { createApp } = require('../../src/app');
const { TransactionStore } = require('../../src/models/transactionStore');

/**
 * Starts the API on an ephemeral port and returns helpers for talking to it.
 *
 * Each test gets its own store, so tests never see each other's transactions.
 * The rate limiter is off by default (a 100-request budget would otherwise be
 * shared by the whole file); pass `rateLimit` to exercise it.
 *
 * @param {{rateLimit?: object, seed?: object[]}} [options]
 */
async function startTestServer({ rateLimit = { enabled: false }, seed = [] } = {}) {
  const store = new TransactionStore();
  const app = createApp({ store, rateLimit });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  /** fetch wrapper returning { status, headers, body } with JSON parsed. */
  async function request(method, path, { body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers['Content-Type'] ??= 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    return {
      status: response.status,
      headers: response.headers,
      body: isJson && text ? JSON.parse(text) : text,
    };
  }

  const api = {
    baseUrl,
    store,
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { body, ...options }),
    /** Creates a transaction and returns the created resource. */
    async createTransaction(overrides = {}) {
      const payload = {
        fromAccount: 'ACC-12345',
        toAccount: 'ACC-67890',
        amount: 100.5,
        currency: 'USD',
        type: 'transfer',
        ...overrides,
      };
      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }
      const response = await request('POST', '/transactions', { body: payload });
      if (response.status !== 201) {
        throw new Error(`fixture creation failed: ${JSON.stringify(response.body)}`);
      }
      return response.body;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };

  for (const row of seed) await api.createTransaction(row);
  return api;
}

module.exports = { startTestServer };
