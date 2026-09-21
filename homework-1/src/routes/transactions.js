'use strict';

const express = require('express');

const { serializeTransaction } = require('../models/transaction');
const { validateCreateTransaction } = require('../validators/transactionValidator');
const { validateTransactionFilters, validateExportFormat } = require('../validators/queryValidator');
const { requireJsonBody } = require('../middleware/requireJsonBody');
const { NotFoundError } = require('../utils/errors');
const { toCsv, csvFileName } = require('../services/csvExporter');

/**
 * Routes mounted under /transactions.
 *
 * @param {import('../models/transactionStore').TransactionStore} store
 * @returns {import('express').Router}
 */
function createTransactionsRouter(store) {
  const router = express.Router();

  /** POST /transactions - create a transaction. */
  router.post('/', requireJsonBody, (req, res) => {
    const input = validateCreateTransaction(req.body);
    const record = store.create(input);
    res.status(201)
      .location(`/transactions/${record.id}`)
      .json(serializeTransaction(record));
  });

  /**
   * GET /transactions/export?format=csv - export the (optionally filtered)
   * ledger. Registered before /:id, otherwise "export" would be read as an id.
   */
  router.get('/export', (req, res) => {
    const format = validateExportFormat(req.query);
    const records = store.list(validateTransactionFilters(req.query));

    if (format === 'json') {
      return res.json(records.map(serializeTransaction));
    }
    return res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${csvFileName()}"`)
      .send(toCsv(records));
  });

  /**
   * GET /transactions - list transactions, newest first.
   * Filters: accountId, type, status, currency, from, to (combinable).
   */
  router.get('/', (req, res) => {
    const records = store.list(validateTransactionFilters(req.query));
    res.json(records.map(serializeTransaction));
  });

  /** GET /transactions/:id - fetch one transaction. */
  router.get('/:id', (req, res) => {
    const record = store.findById(req.params.id);
    if (!record) throw new NotFoundError(`Transaction ${req.params.id} not found`);
    res.json(serializeTransaction(record));
  });

  return router;
}

module.exports = { createTransactionsRouter };
