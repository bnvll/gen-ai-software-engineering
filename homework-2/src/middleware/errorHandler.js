'use strict';

const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const { ApiError: AE, ValidationError } = require('../utils/errors');
  if (err instanceof AE) {
    return res.status(err.status).json(err.toJSON());
  }

  switch (err?.type) {
    case 'entity.parse.failed':
      return res.status(400).json({
        error: 'Bad request',
        message: 'Request body is not valid JSON',
      });
    case 'entity.too.large':
      return res.status(413).json({
        error: 'Payload too large',
        message: 'Request body exceeds the maximum accepted size',
      });
    default:
      break;
  }

  if (err?.name === 'MulterError') {
    return res.status(400).json({
      error: 'Malformed file',
      message: err.message,
    });
  }

  logger.error(`unhandled error on ${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
  return res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred while processing the request',
  });
}

module.exports = { errorHandler, ApiError };
