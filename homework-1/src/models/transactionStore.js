'use strict';

const { createTransactionRecord, touchesAccount } = require('./transaction');

/**
 * In-memory transaction store (no database, per the assignment).
 *
 * Records are kept in insertion order in an array and indexed by id in a Map,
 * so lookups by id stay O(1) instead of scanning the array. Data lives for the
 * lifetime of the process only - restarting the server empties the ledger.
 */
class TransactionStore {
  constructor() {
    /** @type {object[]} insertion-ordered records */
    this.records = [];
    /** @type {Map<string, object>} id -> record */
    this.byId = new Map();
    /** Monotonic insertion counter, used to break ties when sorting. */
    this.sequence = 0;
  }

  /** Inserts a validated transaction and returns the stored record. */
  create(input) {
    const record = createTransactionRecord(input);
    record.seq = this.sequence += 1;
    this.records.push(record);
    this.byId.set(record.id, record);
    return record;
  }

  /** @returns {?object} the record, or undefined when the id is unknown. */
  findById(id) {
    return this.byId.get(id);
  }

  /**
   * Returns records newest-first, optionally filtered.
   *
   * @param {{accountId?: string, type?: string, status?: string,
   *          currency?: string, from?: Date, to?: Date}} [filters]
   */
  list(filters = {}) {
    const matches = this.records.filter((record) => {
      if (filters.accountId && !touchesAccount(record, filters.accountId)) return false;
      if (filters.type && record.type !== filters.type) return false;
      if (filters.status && record.status !== filters.status) return false;
      if (filters.currency && record.currency !== filters.currency) return false;
      if (filters.from || filters.to) {
        const at = new Date(record.timestamp).getTime();
        if (filters.from && at < filters.from.getTime()) return false;
        if (filters.to && at > filters.to.getTime()) return false;
      }
      return true;
    });

    // Newest first; ties fall back to insertion order (later insert first).
    // `seq` keeps the tie-break O(1) - looking the record up in the array
    // instead would make the whole sort quadratic.
    return matches.sort((a, b) => {
      const delta = new Date(b.timestamp) - new Date(a.timestamp);
      return delta !== 0 ? delta : b.seq - a.seq;
    });
  }

  /** All records touching an account, newest-first. */
  listForAccount(accountId) {
    return this.list({ accountId });
  }

  /** True when the account appears on either side of at least one transaction. */
  hasAccount(accountId) {
    return this.records.some((record) => touchesAccount(record, accountId));
  }

  get size() {
    return this.records.length;
  }

  /** Empties the store (used by the test suite). */
  reset() {
    this.records = [];
    this.byId.clear();
    this.sequence = 0;
  }
}

module.exports = { TransactionStore };
