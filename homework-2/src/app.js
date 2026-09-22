'use strict';

const path = require('node:path');
const express = require('express');

const { TicketStore } = require('./stores/ticketStore');
const { createTicketsRouter } = require('./routes/tickets');
const { requestLogger } = require('./middleware/requestLogger');
const { notFoundHandler } = require('./middleware/notFoundHandler');
const { errorHandler } = require('./middleware/errorHandler');
const { CATEGORIES, PRIORITIES, STATUSES, SOURCES, DEVICE_TYPES } = require('./models/ticket');
const { version } = require('../package.json');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * @param {{store: TicketStore}} options
 */
function createApp({ store }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('json spaces', 2);

  app.use(requestLogger);
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/tickets/import') return next();
    return express.json({ limit: '1mb', strict: true })(req, res, next);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      ticketCount: store.size,
    });
  });

  app.get('/api', (_req, res) => {
    res.json({
      name: 'Intelligent Customer Support API',
      version,
      documentation: 'docs/API_REFERENCE.md',
      endpoints: [
        { method: 'POST', path: '/tickets', description: 'Create a ticket (optional ?auto_classify=true)' },
        { method: 'POST', path: '/tickets/import', description: 'Bulk import CSV, JSON or XML' },
        { method: 'GET', path: '/tickets', description: 'List tickets (filters: category, priority, status, customer_id, assigned_to, q)' },
        { method: 'GET', path: '/tickets/:id', description: 'Retrieve a ticket including classification log' },
        { method: 'PUT', path: '/tickets/:id', description: 'Update a ticket (manual override of category/priority is logged)' },
        { method: 'DELETE', path: '/tickets/:id', description: 'Delete a ticket' },
        { method: 'POST', path: '/tickets/:id/auto-classify', description: 'Run rule-based classification' },
        { method: 'GET', path: '/health', description: 'Liveness probe' },
      ],
      enums: { category: CATEGORIES, priority: PRIORITIES, status: STATUSES, source: SOURCES, device_type: DEVICE_TYPES },
    });
  });

  app.use('/tickets', createTicketsRouter(store));
  app.use(express.static(PUBLIC_DIR));
  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.store = store;
  return app;
}

module.exports = { createApp, PUBLIC_DIR };
