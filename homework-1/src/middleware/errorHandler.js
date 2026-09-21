'use strict';

const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Single JSON error renderer for the whole API (must be registered last).
 *
 * Known failures are `ApiError`s and are rendered as-is. Body-parser failures
 * are translated into readable 4xx responses. Anything else is a bug: it is
 * logged with its stack and reported as a generic 500 so we never leak
 * internals to the client.
 */
// `next` is unused but must stay: Express identifies error handlers by arity.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
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
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'Request body must be UTF-8 encoded JSON',
      });
    default:
      break;
  }

  logger.error(`unhandled error on ${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
  return res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred while processing the request',
  });
}

module.exports = { errorHandler };
