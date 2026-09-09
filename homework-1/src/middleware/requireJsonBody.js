'use strict';

const { ApiError } = require('../utils/errors');

/**
 * Guards write endpoints. Without this, a POST sent without
 * `Content-Type: application/json` silently arrives as an empty body and the
 * client gets a confusing "type is required" instead of "you forgot the
 * header".
 *
 * `req.is()` distinguishes the two failure modes: it returns `null` when the
 * request carries no body at all and `false` when the body is there but is not
 * JSON - which is the difference between a 400 and a 415.
 */
function requireJsonBody(req, res, next) {
  const contentType = req.is('application/json');

  if (contentType === null) {
    return next(new ApiError(400, 'Bad request', 'A JSON request body is required'));
  }
  if (contentType === false) {
    return next(new ApiError(415, 'Unsupported Media Type', 'Content-Type must be application/json'));
  }
  return next();
}

module.exports = { requireJsonBody };
