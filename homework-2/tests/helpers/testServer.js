'use strict';

process.env.LOG_LEVEL = 'silent';

const { createApp } = require('../../src/app');
const { openDatabase } = require('../../src/db');
const { TicketStore } = require('../../src/stores/ticketStore');

async function startTestServer() {
  const db = openDatabase(':memory:');
  const store = new TicketStore(db);
  const app = createApp({ store });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, path, { body, headers = {}, raw } = {}) {
    const init = { method, headers: { ...headers } };
    if (raw !== undefined) {
      init.body = raw;
    } else if (body !== undefined) {
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

  const validTicket = (overrides = {}) => ({
    customer_id: 'CUS-1001',
    customer_email: 'ada@example.com',
    customer_name: 'Ada Lovelace',
    subject: 'Cannot log in to the dashboard',
    description: 'I cannot access my account after the password reset. The login form shows an error.',
    ...overrides,
  });

  return {
    baseUrl,
    store,
    db,
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { body, ...options }),
    put: (path, body, options) => request('PUT', path, { body, ...options }),
    del: (path, options) => request('DELETE', path, options),
    validTicket,
    async createTicket(overrides = {}) {
      const response = await request('POST', '/tickets', { body: validTicket(overrides) });
      if (response.status !== 201) {
        throw new Error(`fixture creation failed: ${JSON.stringify(response.body)}`);
      }
      return response.body;
    },
    close: () => new Promise((resolve) => {
      server.close(() => {
        db.close();
        resolve();
      });
    }),
  };
}

module.exports = { startTestServer };
