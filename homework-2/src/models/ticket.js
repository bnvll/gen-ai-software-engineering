'use strict';

const CATEGORIES = Object.freeze([
  'account_access',
  'technical_issue',
  'billing_question',
  'feature_request',
  'bug_report',
  'other',
]);

const PRIORITIES = Object.freeze(['urgent', 'high', 'medium', 'low']);

const STATUSES = Object.freeze([
  'new',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
]);

const SOURCES = Object.freeze(['web_form', 'email', 'api', 'chat', 'phone']);

const DEVICE_TYPES = Object.freeze(['desktop', 'mobile', 'tablet']);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
}

function parseTags(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseMetadata(value) {
  if (value === undefined || value === null || value === '') {
    return { source: 'api', browser: null, device_type: null };
  }
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { source: 'api', browser: asString(value), device_type: null };
    }
  }
  if (!isPlainObject(value)) {
    return { source: 'api', browser: null, device_type: null };
  }
  return {
    source: asString(value.source) || 'api',
    browser: value.browser == null || value.browser === '' ? null : asString(value.browser),
    device_type: value.device_type == null || value.device_type === ''
      ? null
      : asString(value.device_type),
  };
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  SOURCES,
  DEVICE_TYPES,
  EMAIL_PATTERN,
  isPlainObject,
  asString,
  parseTags,
  parseMetadata,
  parseBoolean,
  nowIso,
};
