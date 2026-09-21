'use strict';

const { formatMinorUnits } = require('../utils/money');

/** Column order of the CSV export. */
const CSV_COLUMNS = ['id', 'fromAccount', 'toAccount', 'amount', 'currency', 'type', 'timestamp', 'status'];

/**
 * RFC 4180 field escaping: wrap in double quotes when the value contains a
 * comma, a quote or a line break, and double up embedded quotes.
 */
function escapeCsvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Renders transaction records as RFC 4180 CSV (CRLF line breaks, header row).
 * Amounts are written with the currency's own precision ("100.50", not "100.5")
 * so the file opens cleanly in a spreadsheet.
 *
 * @param {object[]} records store records (newest-first)
 * @returns {string}
 */
function toCsv(records) {
  const rows = [CSV_COLUMNS.join(',')];

  for (const record of records) {
    rows.push([
      record.id,
      record.fromAccount ?? '',
      record.toAccount ?? '',
      formatMinorUnits(record.amountMinor, record.currency),
      record.currency,
      record.type,
      record.timestamp,
      record.status,
    ].map(escapeCsvField).join(','));
  }

  return `${rows.join('\r\n')}\r\n`;
}

/** Timestamped file name, e.g. transactions-2024-01-31.csv */
function csvFileName(now = new Date()) {
  return `transactions-${now.toISOString().slice(0, 10)}.csv`;
}

module.exports = { toCsv, csvFileName, escapeCsvField, CSV_COLUMNS };
