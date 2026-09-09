'use strict';

const logger = require('../utils/logger');

/**
 * Fixed-window rate limiter (Task 4, option D): at most `max` requests per
 * `windowMs` per client IP.
 *
 * A fixed window is the simplest algorithm that satisfies "100 requests per
 * minute" and needs no dependencies; the trade-off is that a client can send
 * up to 2x max across a window boundary. A sliding window or token bucket
 * would smooth that out - overkill for an in-memory demo API.
 *
 * Counters live in a Map keyed by IP and are pruned lazily, so an idle server
 * does not keep timers alive.
 */
const DEFAULTS = {
  max: 100,
  windowMs: 60_000,
  /** Prune expired windows once the map grows past this many keys. */
  pruneThreshold: 1_000,
};

function readConfigFromEnv(env = process.env) {
  const max = Number.parseInt(env.RATE_LIMIT_MAX ?? '', 10);
  const windowMs = Number.parseInt(env.RATE_LIMIT_WINDOW_MS ?? '', 10);
  return {
    enabled: env.RATE_LIMIT_ENABLED !== 'false',
    max: Number.isInteger(max) && max > 0 ? max : DEFAULTS.max,
    windowMs: Number.isInteger(windowMs) && windowMs > 0 ? windowMs : DEFAULTS.windowMs,
  };
}

/**
 * @param {{enabled?: boolean, max?: number, windowMs?: number}} [options]
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(options = {}) {
  const { enabled, max, windowMs } = { ...readConfigFromEnv(), ...options };
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const windows = new Map();

  function prune(now) {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    if (!enabled) return next();

    const now = Date.now();
    if (windows.size > DEFAULTS.pruneThreshold) prune(now);

    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }
    window.count += 1;

    const remaining = Math.max(0, max - window.count);
    const resetSeconds = Math.ceil((window.resetAt - now) / 1000);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(resetSeconds));

    if (window.count > max) {
      logger.warn(`rate limit exceeded for ${key} (${window.count}/${max})`);
      res.set('Retry-After', String(resetSeconds));
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit of ${max} requests per ${Math.round(windowMs / 1000)}s exceeded. Retry in ${resetSeconds}s`,
        retryAfterSeconds: resetSeconds,
      });
    }
    return next();
  };
}

module.exports = { createRateLimiter, readConfigFromEnv, DEFAULTS };
