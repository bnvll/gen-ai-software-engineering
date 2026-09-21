'use strict';

const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  if (logger.isSilent()) return next();
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  return next();
}

module.exports = { requestLogger };
