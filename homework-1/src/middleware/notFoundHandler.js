'use strict';

const { NotFoundError } = require('../utils/errors');

/** Turns any unmatched route into a JSON 404 instead of Express' HTML page. */
function notFoundHandler(req, _res, next) {
  next(new NotFoundError(
    `Route ${req.method} ${req.path} does not exist. See GET / for the list of available endpoints`,
  ));
}

module.exports = { notFoundHandler };
