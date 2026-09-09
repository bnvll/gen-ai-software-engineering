'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decimalPlaces, toMinorUnits, fromMinorUnits, formatMinorUnits } = require('../src/utils/money');
const { parseIsoTimestamp, parseDateBoundary } = require('../src/utils/dates');
const { allowedDecimals, isSupportedCurrency } = require('../src/utils/currencies');
const { isValidAccountId, normalizeAccountId } = require('../src/utils/accounts');

test('decimalPlaces counts decimals, including exponential notation', () => {
  assert.equal(decimalPlaces(100), 0);
  assert.equal(decimalPlaces(100.5), 1);
  assert.equal(decimalPlaces(100.55), 2);
  assert.equal(decimalPlaces(100.555), 3);
  assert.equal(decimalPlaces(1e-7), 7, '0.0000001 must not look like an integer');
  assert.equal(decimalPlaces(1.5e2), 0);
});

test('money round-trips through minor units', () => {
  assert.equal(toMinorUnits(100.5, 'USD'), 10050);
  assert.equal(fromMinorUnits(10050, 'USD'), 100.5);
  assert.equal(toMinorUnits(15000, 'JPY'), 15000, 'JPY has no minor unit');
  assert.equal(fromMinorUnits(15000, 'JPY'), 15000);
  assert.equal(formatMinorUnits(10050, 'USD'), '100.50');
  assert.equal(formatMinorUnits(15000, 'JPY'), '15000');
});

test('minor units keep cent arithmetic exact', () => {
  const cents = [0.1, 0.2].reduce((sum, amount) => sum + toMinorUnits(amount, 'USD'), 0);
  assert.equal(fromMinorUnits(cents, 'USD'), 0.3);
  assert.notEqual(0.1 + 0.2, 0.3, 'which plain float addition would not');
});

test('currency precision follows ISO 4217, capped at 2 decimals', () => {
  assert.equal(allowedDecimals('USD'), 2);
  assert.equal(allowedDecimals('JPY'), 0);
  assert.equal(allowedDecimals('KWD'), 2, '3-decimal currencies are capped at 2 by the API contract');
  assert.ok(isSupportedCurrency('eur'));
  assert.ok(!isSupportedCurrency('XYZ'));
});

test('account ids are validated and normalized', () => {
  assert.ok(isValidAccountId('ACC-12345'));
  assert.ok(isValidAccountId('acc-a1b2c'));
  assert.ok(!isValidAccountId('ACC-1234'));
  assert.ok(!isValidAccountId('ACC-123456'));
  assert.ok(!isValidAccountId(''));
  assert.ok(!isValidAccountId(undefined));
  assert.equal(normalizeAccountId(' acc-12345 '), 'ACC-12345');
});

test('parseIsoTimestamp accepts ISO 8601 and rejects impossible dates', () => {
  assert.equal(parseIsoTimestamp('2024-01-15T10:30:00Z').toISOString(), '2024-01-15T10:30:00.000Z');
  assert.equal(parseIsoTimestamp('2024-01-15T12:30:00+02:00').toISOString(), '2024-01-15T10:30:00.000Z');
  assert.equal(parseIsoTimestamp('2024-01-15').toISOString(), '2024-01-15T00:00:00.000Z');
  assert.equal(parseIsoTimestamp('2024-02-31'), null, '31 February does not exist');
  assert.equal(parseIsoTimestamp('15/01/2024'), null);
  assert.equal(parseIsoTimestamp(20240115), null);
});

test('parseDateBoundary expands bare dates to whole UTC days', () => {
  assert.equal(parseDateBoundary('2024-01-31').toISOString(), '2024-01-31T00:00:00.000Z');
  assert.equal(parseDateBoundary('2024-01-31', { endOfDay: true }).toISOString(), '2024-01-31T23:59:59.999Z');
  assert.equal(
    parseDateBoundary('2024-01-31T10:00:00Z', { endOfDay: true }).toISOString(),
    '2024-01-31T10:00:00.000Z',
    'an explicit instant is used as given',
  );
});
