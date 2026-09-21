'use strict';

const { createApp } = require('./app');
const { TransactionStore } = require('./models/transactionStore');
const { seedStore } = require('./utils/seed');
const { readConfigFromEnv } = require('./middleware/rateLimit');
const logger = require('./utils/logger');

/**
 * Process bootstrap: build the store, optionally seed it, start listening and
 * shut down cleanly on SIGINT / SIGTERM.
 *
 * Environment variables:
 *   PORT                  port to listen on           (default 3000)
 *   HOST                  interface to bind            (default 0.0.0.0)
 *   SEED_FILE             JSON file of transactions to preload (optional)
 *   RATE_LIMIT_ENABLED    "false" disables the limiter (default enabled)
 *   RATE_LIMIT_MAX        requests per window          (default 100)
 *   RATE_LIMIT_WINDOW_MS  window length in ms          (default 60000)
 *   LOG_LEVEL             "silent" mutes request logs
 */
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

function main() {
  const store = new TransactionStore();

  if (process.env.SEED_FILE) {
    try {
      const loaded = seedStore(store, process.env.SEED_FILE);
      logger.info(`seeded ${loaded} transactions from ${process.env.SEED_FILE}`);
    } catch (error) {
      logger.error(`failed to seed from ${process.env.SEED_FILE}: ${error.message}`);
      process.exit(1);
    }
  }

  const app = createApp({ store });
  const server = app.listen(PORT, HOST, () => {
    const limits = readConfigFromEnv();
    logger.info(`Banking Transactions API listening on http://localhost:${PORT}`);
    logger.info(`storage: in-memory (${store.size} transactions loaded)`);
    logger.info(limits.enabled
      ? `rate limit: ${limits.max} requests / ${Math.round(limits.windowMs / 1000)}s per IP`
      : 'rate limit: disabled');
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
      server.close(() => process.exit(0));
    });
  }

  return server;
}

if (require.main === module) main();

module.exports = { main };
