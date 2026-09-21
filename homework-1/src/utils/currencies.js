'use strict';

/**
 * Curated subset of active ISO 4217 currency codes.
 *
 * `exponent` is the number of decimal places the currency officially uses
 * (ISO 4217 "minor unit"). Most currencies use 2, JPY/KRW use 0, and a few
 * (BHD, KWD, ...) use 3. We cap accepted precision at 2 decimals because the
 * assignment requires it, but we still refuse 100.50 JPY - that amount does
 * not exist.
 *
 * To support more currencies, add the code here; no other file needs to change.
 */
const CURRENCIES = {
  AED: { name: 'UAE Dirham', exponent: 2 },
  AUD: { name: 'Australian Dollar', exponent: 2 },
  BGN: { name: 'Bulgarian Lev', exponent: 2 },
  BHD: { name: 'Bahraini Dinar', exponent: 3 },
  BRL: { name: 'Brazilian Real', exponent: 2 },
  CAD: { name: 'Canadian Dollar', exponent: 2 },
  CHF: { name: 'Swiss Franc', exponent: 2 },
  CNY: { name: 'Yuan Renminbi', exponent: 2 },
  CZK: { name: 'Czech Koruna', exponent: 2 },
  DKK: { name: 'Danish Krone', exponent: 2 },
  EUR: { name: 'Euro', exponent: 2 },
  GBP: { name: 'Pound Sterling', exponent: 2 },
  HKD: { name: 'Hong Kong Dollar', exponent: 2 },
  HUF: { name: 'Forint', exponent: 2 },
  IDR: { name: 'Rupiah', exponent: 2 },
  ILS: { name: 'New Israeli Sheqel', exponent: 2 },
  INR: { name: 'Indian Rupee', exponent: 2 },
  ISK: { name: 'Iceland Krona', exponent: 0 },
  JPY: { name: 'Yen', exponent: 0 },
  KRW: { name: 'Won', exponent: 0 },
  KWD: { name: 'Kuwaiti Dinar', exponent: 3 },
  MXN: { name: 'Mexican Peso', exponent: 2 },
  MYR: { name: 'Malaysian Ringgit', exponent: 2 },
  NOK: { name: 'Norwegian Krone', exponent: 2 },
  NZD: { name: 'New Zealand Dollar', exponent: 2 },
  PLN: { name: 'Zloty', exponent: 2 },
  RON: { name: 'Romanian Leu', exponent: 2 },
  SAR: { name: 'Saudi Riyal', exponent: 2 },
  SEK: { name: 'Swedish Krona', exponent: 2 },
  SGD: { name: 'Singapore Dollar', exponent: 2 },
  THB: { name: 'Baht', exponent: 2 },
  TRY: { name: 'Turkish Lira', exponent: 2 },
  USD: { name: 'US Dollar', exponent: 2 },
  ZAR: { name: 'Rand', exponent: 2 },
};

/** Precision we are willing to accept from clients, per the assignment. */
const MAX_ACCEPTED_DECIMALS = 2;

function isSupportedCurrency(code) {
  return typeof code === 'string' && Object.hasOwn(CURRENCIES, code.toUpperCase());
}

/** Decimal places allowed for a currency: the ISO minor unit, capped at 2. */
function allowedDecimals(code) {
  const currency = CURRENCIES[String(code).toUpperCase()];
  if (!currency) return MAX_ACCEPTED_DECIMALS;
  return Math.min(currency.exponent, MAX_ACCEPTED_DECIMALS);
}

function supportedCurrencyCodes() {
  return Object.keys(CURRENCIES).sort();
}

module.exports = {
  CURRENCIES,
  MAX_ACCEPTED_DECIMALS,
  isSupportedCurrency,
  allowedDecimals,
  supportedCurrencyCodes,
};
