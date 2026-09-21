'use strict';

const express = require('express');

const {
  validateAccountIdParam,
  validateCurrencySelector,
  validateInterestParams,
} = require('../validators/queryValidator');
const { getBalance, getSummary, getSimpleInterest } = require('../services/accountService');

/**
 * Routes mounted under /accounts. All figures are derived from the transaction
 * ledger; there is no separate account resource.
 *
 * @param {import('../models/transactionStore').TransactionStore} store
 * @returns {import('express').Router}
 */
function createAccountsRouter(store) {
  const router = express.Router();

  /**
   * GET /accounts/:accountId/balance - balance per currency.
   * Add ?currency=USD to get a single-currency response.
   */
  router.get('/:accountId/balance', (req, res) => {
    const accountId = validateAccountIdParam(req.params.accountId);
    const currency = validateCurrencySelector(req.query);
    res.json(getBalance(store, accountId, currency));
  });

  /** GET /accounts/:accountId/summary - deposits, withdrawals, counts, last activity. */
  router.get('/:accountId/summary', (req, res) => {
    const accountId = validateAccountIdParam(req.params.accountId);
    const currency = validateCurrencySelector(req.query);
    res.json(getSummary(store, accountId, currency));
  });

  /** GET /accounts/:accountId/interest?rate=0.05&days=30 - simple interest. */
  router.get('/:accountId/interest', (req, res) => {
    const accountId = validateAccountIdParam(req.params.accountId);
    const currency = validateCurrencySelector(req.query);
    const { rate, days } = validateInterestParams(req.query);
    res.json(getSimpleInterest(store, accountId, { rate, days, currency }));
  });

  return router;
}

module.exports = { createAccountsRouter };
