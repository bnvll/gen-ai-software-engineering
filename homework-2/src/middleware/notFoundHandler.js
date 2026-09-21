'use strict';

const { NotFoundError } = require('../utils/errors');

function notFoundHandler(req, _res, next) {
  next(new NotFoundError(
    `Route ${req.method} ${req.path} does not exist. See GET /api for the list of available endpoints`,
  ));
}

module.exports = { notFoundHandler };
