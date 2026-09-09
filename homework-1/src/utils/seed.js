'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateCreateTransaction } = require('../validators/transactionValidator');
const { ValidationError } = require('./errors');

/**
 * Loads a JSON array of transactions into the store at start-up
 * (`SEED_FILE=demo/sample-data.json npm start`).
 *
 * Seed rows go through the exact same validator as HTTP requests, so the demo
 * data can never contain something the API itself would reject.
 *
 * @param {import('../models/transactionStore').TransactionStore} store
 * @param {string} filePath path relative to the project root (or absolute)
 * @returns {number} number of transactions loaded
 * @throws {Error} when the file is missing, not an array, or contains an
 *   invalid row
 */
function seedStore(store, filePath) {
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed?.transactions;

  if (!Array.isArray(rows)) {
    throw new Error(`Seed file ${resolved} must contain a JSON array of transactions (or { "transactions": [...] })`);
  }

  rows.forEach((row, index) => {
    try {
      store.create(validateCreateTransaction(row));
    } catch (error) {
      if (error instanceof ValidationError) {
        const details = error.details.map((d) => `${d.field}: ${d.message}`).join('; ');
        throw new Error(`Seed row ${index} is invalid -> ${details}`);
      }
      throw error;
    }
  });

  return rows.length;
}

module.exports = { seedStore };
