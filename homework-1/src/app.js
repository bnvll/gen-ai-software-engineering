'use strict';

const express = require('express');

const { TransactionStore } = require('./models/transactionStore');
const { createTransactionsRouter } = require('./routes/transactions');
const { createAccountsRouter } = require('./routes/accounts');
const { createRateLimiter } = require('./middleware/rateLimit');
const { requestLogger } = require('./middleware/requestLogger');
const { notFoundHandler } = require('./middleware/notFoundHandler');
const { errorHandler } = require('./middleware/errorHandler');
const { supportedCurrencyCodes } = require('./utils/currencies');
const { TRANSACTION_TYPES, TRANSACTION_STATUSES } = require('./models/transaction');
const { version } = require('../package.json');

/** Largest request body we accept - a transaction is a few hundred bytes. */
const BODY_LIMIT = '64kb';

/**
 * Builds the Express application.
 *
 * The app is created by a factory (rather than being a module-level singleton)
 * so tests can spin up an isolated instance with its own store, and so the
 * rate limiter can be reconfigured per instance.
 *
 * @param {{store?: TransactionStore, rateLimit?: object}} [options]
 */
function createApp({ store = new TransactionStore(), rateLimit = {} } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('json spaces', 2);

  app.use(requestLogger);
  app.use(createRateLimiter(rateLimit));
  app.use(express.json({ limit: BODY_LIMIT, strict: true }));

  /** Liveness probe - handy for the run script and for demos. */
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      transactionCount: store.size,
    });
  });

  /** Service index: what this API offers, in one request. */
  app.get('/', (_req, res) => {
    res.json({
      name: 'Banking Transactions API',
      version,
      documentation: 'docs/api-reference.md',
      endpoints: [
        { method: 'POST', path: '/transactions', description: 'Create a transaction' },
        { method: 'GET', path: '/transactions', description: 'List transactions (filters: accountId, type, status, currency, from, to)' },
        { method: 'GET', path: '/transactions/:id', description: 'Retrieve a transaction' },
        { method: 'GET', path: '/transactions/export?format=csv', description: 'Export transactions as CSV' },
        { method: 'GET', path: '/accounts/:accountId/balance', description: 'Account balance per currency' },
        { method: 'GET', path: '/accounts/:accountId/summary', description: 'Deposits, withdrawals, counts, last activity' },
        { method: 'GET', path: '/accounts/:accountId/interest?rate=0.05&days=30', description: 'Simple interest on the current balance' },
        { method: 'GET', path: '/health', description: 'Liveness probe' },
      ],
      enums: {
        type: TRANSACTION_TYPES,
        status: TRANSACTION_STATUSES,
        currency: supportedCurrencyCodes(),
      },
    });
  });

  app.use('/transactions', createTransactionsRouter(store));
  app.use('/accounts', createAccountsRouter(store));

  app.use(notFoundHandler);
  app.use(errorHandler);

  // Exposed so tests and the bootstrap can seed or inspect the ledger.
  app.locals.store = store;
  return app;
}

module.exports = { createApp, BODY_LIMIT };
