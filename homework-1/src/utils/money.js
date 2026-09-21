'use strict';

const { allowedDecimals } = require('./currencies');

/**
 * Money is stored as an integer number of minor units (cents) and only ever
 * converted back to a decimal at the edge of the API. Summing IEEE-754 floats
 * such as 0.1 + 0.2 silently produces 0.30000000000000004, which is not an
 * acceptable failure mode for account balances.
 */

/** Counts the decimal places of a JSON number, incl. exponential notation. */
function decimalPlaces(value) {
  const text = String(value).toLowerCase();
  if (!text.includes('e')) {
    const [, decimals = ''] = text.split('.');
    return decimals.length;
  }
  const [mantissa, exponent] = text.split('e');
  const [, mantissaDecimals = ''] = mantissa.split('.');
  return Math.max(0, mantissaDecimals.length - Number(exponent));
}

/** Converts a decimal amount into integer minor units for a given currency. */
function toMinorUnits(amount, currency) {
  const factor = 10 ** allowedDecimals(currency);
  return Math.round(amount * factor);
}

/** Converts integer minor units back into a JSON-safe decimal number. */
function fromMinorUnits(minorUnits, currency) {
  const decimals = allowedDecimals(currency);
  return Number((minorUnits / 10 ** decimals).toFixed(decimals));
}

/** Formats minor units as a fixed-precision string, e.g. "100.50". */
function formatMinorUnits(minorUnits, currency) {
  const decimals = allowedDecimals(currency);
  return (minorUnits / 10 ** decimals).toFixed(decimals);
}

module.exports = { decimalPlaces, toMinorUnits, fromMinorUnits, formatMinorUnits };
