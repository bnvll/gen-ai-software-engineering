'use strict';

/**
 * Errors that are safe to render to the client. Anything that is not an
 * ApiError is treated as a bug and reported as a generic 500.
 */
class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} error  short, stable error label ("Not found")
   * @param {string} message human readable explanation
   */
  constructor(status, error, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
  }

  toJSON() {
    return { error: this.error, message: this.message };
  }
}

/**
 * 400 with a per-field breakdown, matching the response shape required by the
 * assignment:
 * { "error": "Validation failed", "details": [{ "field", "message" }] }
 */
class ValidationError extends ApiError {
  /** @param {{field: string, message: string}[]} details */
  constructor(details) {
    super(400, 'Validation failed', 'One or more fields are invalid');
    this.name = 'ValidationError';
    this.details = details;
  }

  toJSON() {
    return { error: this.error, details: this.details };
  }
}

class NotFoundError extends ApiError {
  constructor(message) {
    super(404, 'Not found', message);
    this.name = 'NotFoundError';
  }
}

/** Collects field errors so a request reports *all* its problems at once. */
class ValidationErrorBag {
  constructor() {
    this.details = [];
  }

  add(field, message) {
    this.details.push({ field, message });
    return this;
  }

  get isEmpty() {
    return this.details.length === 0;
  }

  /** @throws {ValidationError} when at least one field error was collected. */
  throwIfAny() {
    if (!this.isEmpty) throw new ValidationError(this.details);
  }
}

module.exports = { ApiError, ValidationError, NotFoundError, ValidationErrorBag };
