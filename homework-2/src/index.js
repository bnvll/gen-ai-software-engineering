'use strict';

const path = require('node:path');
const { createApp } = require('./app');
const { openDatabase } = require('./db');
const { TicketStore } = require('./stores/ticketStore');
const logger = require('./utils/logger');

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const DEFAULT_DB = path.join(__dirname, '..', 'data', 'tickets.db');

function main() {
  const filename = process.env.SQLITE_PATH ?? DEFAULT_DB;
  const db = openDatabase(filename);
  const store = new TicketStore(db);
  const app = createApp({ store });

  const server = app.listen(PORT, HOST, () => {
    logger.info(`Customer Support API listening on http://localhost:${PORT}`);
    logger.info(`storage: sqlite (${filename}) — ${store.size} tickets`);
    logger.info('agent UI: open / in a browser');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`port ${PORT} is already in use. Set PORT=<other port> and retry`);
      process.exit(1);
    }
    throw error;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      logger.info(`${signal} received, shutting down`);
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  }

  return server;
}

if (require.main === module) main();

module.exports = { main };
